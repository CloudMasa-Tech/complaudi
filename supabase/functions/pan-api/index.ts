// supabase/functions/pan-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { assertCan, getAuthContext } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { BadRequestError, NotFoundError, AppError } from '../_shared/errors.ts';
import { PAN_REGEX } from '../_shared/india.ts';
import { getPanVerificationProvider } from '../_shared/verifications/index.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handlePanApiRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/\/+$/, '');
    const path = rawPath
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/\/+$/, '') || '/';

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // POST /pan/verify OR POST /verify
    if (req.method === 'POST' && (normalizedPath === '/verify' || normalizedPath === '/pan/verify')) {
      const authCtx = await getAuthContext(req);

      let body: any;
      try {
        body = await req.json();
      } catch (_e) {
        throw new BadRequestError('Invalid JSON request body.');
      }

      const companyId = body?.companyId;
      if (!companyId || typeof companyId !== 'string' || !UUID_REGEX.test(companyId.trim())) {
        throw new BadRequestError('companyId is required and must be a valid UUID.');
      }

      const pan = body?.pan;
      if (!pan || typeof pan !== 'string' || !PAN_REGEX.test(pan.trim().toUpperCase())) {
        throw new BadRequestError(`Invalid PAN format "${pan || ''}". PAN must be 10 characters (e.g. AAACT1234A).`);
      }

      const cleanCompanyId = companyId.trim();
      const cleanPan = pan.trim().toUpperCase();

      await assertCan(authCtx, cleanCompanyId, 'company.edit');

      const provider = getPanVerificationProvider();
      const result = await provider.verifyPan(cleanPan);

      if (!result.success) {
        const errCode = result.error?.code;
        const msg = result.error?.message || 'PAN verification failed.';

        if (errCode === 'INVALID_PAN') {
          throw new BadRequestError(msg);
        }
        if (errCode === 'PAN_NOT_FOUND') {
          throw new NotFoundError(msg);
        }
        if (errCode === 'SERVICE_UNAVAILABLE') {
          throw new AppError(msg, 502, 'SERVICE_UNAVAILABLE');
        }
        if (errCode === 'UNAUTHORIZED') {
          throw new AppError(msg, 502, 'PROVIDER_UNAUTHORIZED');
        }

        throw new AppError(msg, 500, 'PROVIDER_ERROR');
      }

      return jsonResponse({
        success: true,
        pan: result.data?.pan || cleanPan,
        data: result.data,
      });
    }

    throw new NotFoundError(`Endpoint not found: ${req.method} ${url.pathname}`);
  } catch (err: any) {
    return errorResponse(err);
  }
}

if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  (Deno as any).serve(handlePanApiRequest);
}
