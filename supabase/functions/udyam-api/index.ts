// supabase/functions/udyam-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { assertCan, getAuthContext } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { BadRequestError, NotFoundError, AppError } from '../_shared/errors.ts';
import { UDYAM_REGEX } from '../_shared/india.ts';
import { getUdyamVerificationProvider } from '../_shared/verifications/index.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleUdyamApiRequest(req: Request): Promise<Response> {
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

    // POST /udyam/session OR POST /session
    if (req.method === 'POST' && (normalizedPath === '/session' || normalizedPath === '/udyam/session')) {
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

      const rawUdyam = body?.udyam_number ?? body?.udyamNumber;
      if (!rawUdyam || typeof rawUdyam !== 'string' || !UDYAM_REGEX.test(rawUdyam.trim().toUpperCase())) {
        throw new BadRequestError(`Invalid Udyam registration number format "${rawUdyam || ''}".`);
      }

      const cleanCompanyId = companyId.trim();
      const cleanUdyam = rawUdyam.trim().toUpperCase();

      await assertCan(authCtx, cleanCompanyId, 'company.edit');

      const provider = getUdyamVerificationProvider();
      const sessionRes = await provider.createSession(cleanUdyam);

      if (!sessionRes.success) {
        const errCode = sessionRes.error?.code;
        const msg = sessionRes.error?.message || 'Udyam verification service is temporarily unavailable. Please try again later.';

        if (errCode === 'INVALID_UDYAM') {
          throw new BadRequestError(msg);
        }
        if (errCode === 'UDYAM_NOT_FOUND') {
          throw new NotFoundError(msg);
        }
        if (errCode === 'SERVICE_UNAVAILABLE') {
          throw new AppError(msg, 502, 'SERVICE_UNAVAILABLE');
        }
        if (errCode === 'UNAUTHORIZED') {
          throw new AppError(msg, 502, 'PROVIDER_UNAUTHORIZED');
        }

        throw new AppError(msg, 502, 'SERVICE_UNAVAILABLE');
      }

      return jsonResponse({
        success: true,
        sessionId: sessionRes.sessionId,
        udyamNumber: sessionRes.udyamNumber || cleanUdyam,
        captchaImage: sessionRes.captchaImage,
        expiresAt: sessionRes.expiresAt,
      });
    }

    // POST /udyam/verify OR POST /verify
    if (req.method === 'POST' && (normalizedPath === '/verify' || normalizedPath === '/udyam/verify')) {
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

      const sessionId = body?.sessionId;
      if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new BadRequestError('sessionId is required.');
      }

      const captcha = body?.captcha;
      if (!captcha || typeof captcha !== 'string' || !captcha.trim()) {
        throw new BadRequestError('captcha is required.');
      }

      const rawUdyam = body?.udyam_number ?? body?.udyamNumber;
      if (!rawUdyam || typeof rawUdyam !== 'string' || !UDYAM_REGEX.test(rawUdyam.trim().toUpperCase())) {
        throw new BadRequestError(`Invalid Udyam registration number format "${rawUdyam || ''}".`);
      }

      const cleanCompanyId = companyId.trim();
      const cleanSessionId = sessionId.trim();
      const cleanCaptcha = captcha.trim();
      const cleanUdyam = rawUdyam.trim().toUpperCase();

      await assertCan(authCtx, cleanCompanyId, 'company.edit');

      const provider = getUdyamVerificationProvider();
      const verifyRes = await provider.verifySession({
        sessionId: cleanSessionId,
        udyamNumber: cleanUdyam,
        captcha: cleanCaptcha,
      });

      if (!verifyRes.success) {
        const errCode = verifyRes.error?.code;
        const msg = verifyRes.error?.message || 'Udyam verification service is temporarily unavailable. Please try again later.';

        if (errCode === 'INVALID_CAPTCHA' || errCode === 'SESSION_EXPIRED' || errCode === 'INVALID_UDYAM') {
          throw new BadRequestError(msg);
        }
        if (errCode === 'UDYAM_NOT_FOUND') {
          throw new NotFoundError(msg);
        }
        if (errCode === 'SERVICE_UNAVAILABLE') {
          throw new AppError(msg, 502, 'SERVICE_UNAVAILABLE');
        }
        if (errCode === 'UNAUTHORIZED') {
          throw new AppError(msg, 502, 'PROVIDER_UNAUTHORIZED');
        }

        throw new AppError(msg, 502, 'SERVICE_UNAVAILABLE');
      }

      return jsonResponse({
        success: true,
        udyamNumber: verifyRes.data?.udyamNumber || cleanUdyam,
        registration: verifyRes.data,
        data: verifyRes.data,
        rawResponse: verifyRes.rawResponse,
      });
    }

    throw new NotFoundError(`No route matches ${req.method} ${url.pathname}`);
  } catch (err: any) {
    return errorResponse(err);
  }
}

// @ts-ignore
if (typeof Deno !== 'undefined' && Deno.serve) {
  // @ts-ignore
  Deno.serve(handleUdyamApiRequest);
}
