// src/lib/verifications/panApi.ts
import { PAN_REGEX } from '../india';
import { getPanVerificationProvider } from './index';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function handlePanApiRequest(
  req: Request,
  deps?: {
    getAuthContext?: (req: Request) => Promise<any>;
    assertCan?: (ctx: any, companyId: string, cap: string) => Promise<void>;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/\/+$/, '');
    const path = rawPath
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/\/+$/, '') || '/';

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    if (req.method === 'POST' && (normalizedPath === '/verify' || normalizedPath === '/pan/verify')) {
      const getAuth = deps?.getAuthContext || (async () => {
        throw { statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required' };
      });
      const assertPermission = deps?.assertCan || (async () => {});

      let authCtx: any;
      try {
        authCtx = await getAuth(req);
      } catch (err: any) {
        return jsonResponse(
          { error: { code: err?.code || 'UNAUTHORIZED', message: err?.message || 'Authentication required' } },
          err?.statusCode || 401
        );
      }

      let body: any;
      try {
        body = await req.json();
      } catch (_e) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON request body.' } }, 400);
      }

      const companyId = body?.companyId;
      if (!companyId || typeof companyId !== 'string' || !UUID_REGEX.test(companyId.trim())) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: 'companyId is required and must be a valid UUID.' } }, 400);
      }

      const pan = body?.pan;
      if (!pan || typeof pan !== 'string' || !PAN_REGEX.test(pan.trim().toUpperCase())) {
        return jsonResponse(
          { error: { code: 'BAD_REQUEST', message: `Invalid PAN format "${pan || ''}". PAN must be 10 characters (e.g. AAACT1234A).` } },
          400
        );
      }

      const cleanCompanyId = companyId.trim();
      const cleanPan = pan.trim().toUpperCase();

      try {
        await assertPermission(authCtx, cleanCompanyId, 'company.edit');
      } catch (err: any) {
        return jsonResponse(
          { error: { code: err?.code || 'FORBIDDEN', message: err?.message || 'Permission denied' } },
          err?.statusCode || 403
        );
      }

      const provider = getPanVerificationProvider();
      const result = await provider.verifyPan(cleanPan);

      if (!result.success) {
        const errCode = result.error?.code;
        const msg = result.error?.message || 'PAN verification failed.';

        if (errCode === 'INVALID_PAN') {
          return jsonResponse({ error: { code: 'BAD_REQUEST', message: msg } }, 400);
        }
        if (errCode === 'PAN_NOT_FOUND') {
          return jsonResponse({ error: { code: 'NOT_FOUND', message: msg } }, 404);
        }
        if (errCode === 'SERVICE_UNAVAILABLE') {
          return jsonResponse({ error: { code: 'SERVICE_UNAVAILABLE', message: msg } }, 502);
        }
        if (errCode === 'UNAUTHORIZED') {
          return jsonResponse({ error: { code: 'PROVIDER_UNAUTHORIZED', message: msg } }, 502);
        }

        return jsonResponse({ error: { code: 'PROVIDER_ERROR', message: msg } }, 500);
      }

      return jsonResponse({
        success: true,
        pan: result.data?.pan || cleanPan,
        data: result.data,
      });
    }

    return jsonResponse({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.method} ${url.pathname}` } }, 404);
  } catch (err: any) {
    return jsonResponse(
      { error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || 'Internal server error' } },
      err?.statusCode || 500
    );
  }
}
