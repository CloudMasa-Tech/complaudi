// src/lib/verifications/gstApi.ts
import { GSTIN_REGEX } from '../india';
import { getGstVerificationProvider } from './index';

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

export async function handleGstApiRequest(
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

    if (req.method === 'POST' && (normalizedPath === '/session' || normalizedPath === '/gst/session')) {
      const getAuth = deps?.getAuthContext || (async () => {
        throw { statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required' };
      });
      const assertPermission = deps?.assertCan || (async () => {});

      const authCtx = await getAuth(req);

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

      const gstin = body?.gstin;
      if (!gstin || typeof gstin !== 'string' || !GSTIN_REGEX.test(gstin.trim().toUpperCase())) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: `Invalid GSTIN format "${gstin || ''}". GSTIN must be 15 alphanumeric characters.` } }, 400);
      }

      const cleanCompanyId = companyId.trim();
      const cleanGstin = gstin.trim().toUpperCase();

      await assertPermission(authCtx, cleanCompanyId, 'company.edit');

      const provider = getGstVerificationProvider();
      const sessionRes = await provider.createSession(cleanGstin);

      if (!sessionRes.success) {
        const errCode = sessionRes.error?.code;
        const msg = sessionRes.error?.message || 'GST session creation failed.';

        if (errCode === 'INVALID_GSTIN') {
          return jsonResponse({ error: { code: 'BAD_REQUEST', message: msg } }, 400);
        }
        if (errCode === 'GSTIN_NOT_FOUND') {
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
        sessionId: sessionRes.sessionId,
        gstin: sessionRes.gstin || cleanGstin,
        captchaImage: sessionRes.captchaImage,
        expiresAt: sessionRes.expiresAt,
      });
    }

    if (req.method === 'POST' && (normalizedPath === '/verify' || normalizedPath === '/gst/verify')) {
      const getAuth = deps?.getAuthContext || (async () => {
        throw { statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required' };
      });
      const assertPermission = deps?.assertCan || (async () => {});

      const authCtx = await getAuth(req);

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

      const sessionId = body?.sessionId;
      if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: 'sessionId is required.' } }, 400);
      }

      const captcha = body?.captcha;
      if (!captcha || typeof captcha !== 'string' || !captcha.trim()) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: 'captcha is required.' } }, 400);
      }

      const gstin = body?.gstin;
      if (!gstin || typeof gstin !== 'string' || !GSTIN_REGEX.test(gstin.trim().toUpperCase())) {
        return jsonResponse({ error: { code: 'BAD_REQUEST', message: `Invalid GSTIN format "${gstin || ''}".` } }, 400);
      }

      const cleanCompanyId = companyId.trim();
      const cleanSessionId = sessionId.trim();
      const cleanCaptcha = captcha.trim();
      const cleanGstin = gstin.trim().toUpperCase();

      await assertPermission(authCtx, cleanCompanyId, 'company.edit');

      const provider = getGstVerificationProvider();
      const verifyRes = await provider.verifySession({
        sessionId: cleanSessionId,
        gstin: cleanGstin,
        captcha: cleanCaptcha,
      });

      if (!verifyRes.success) {
        const errCode = verifyRes.error?.code;
        const msg = verifyRes.error?.message || 'GST verification failed.';

        if (errCode === 'INVALID_CAPTCHA' || errCode === 'SESSION_EXPIRED' || errCode === 'INVALID_GSTIN') {
          return jsonResponse({ error: { code: 'BAD_REQUEST', message: msg } }, 400);
        }
        if (errCode === 'GSTIN_NOT_FOUND') {
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
        gstin: verifyRes.data?.gstin || cleanGstin,
        gst: verifyRes.data,
        rawResponse: verifyRes.rawResponse,
      });
    }

    return jsonResponse({ error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } }, 404);
  } catch (err: any) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'INTERNAL_ERROR';
    const message = err?.message || 'An unexpected error occurred';
    return jsonResponse({ error: { code, message } }, status);
  }
}
