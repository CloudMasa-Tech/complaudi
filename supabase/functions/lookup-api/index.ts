import { handleCors } from '../_shared/cors.ts';
import { getAuthContext } from '../_shared/auth.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { UnprocessableError, NotFoundError } from '../_shared/errors.ts';
import { decodeCin, decodePan, validateGstin } from '../_shared/india.ts';
import { getSupabaseAdminClient } from '../_shared/database.ts';

import { validateCompanyMasterData } from '../_shared/companyValidation.ts';
import { getCompanyVerificationProvider } from '../_shared/verifications/index.ts';

const DERIVED_FROM = 'Derived from the identifier itself — no government service was contacted.';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    // POST /lookup-api/validate-company (Public endpoint for self-onboarding validation)
    if (req.method === 'POST' && (path.endsWith('/validate-company') || path.endsWith('/validate-company/'))) {
      const body = await req.json();

      let existingCinsInDb: string[] = [];
      try {
        const supabase = getSupabaseAdminClient();
        let query = supabase.from('companies').select('id, cin');
        if (body.currentCompanyId) {
          query = query.neq('id', body.currentCompanyId);
        }
        const { data: compRows } = await query;
        if (compRows) {
          existingCinsInDb = compRows.map((c: any) => c.cin).filter(Boolean) as string[];
        }
      } catch (err) {
        console.warn('Could not query database for duplicate CIN check:', err);
      }

      let masterRecord = body.masterRecord ?? null;

      // If CIN is provided, perform live BizVerify verification
      if (body.cin && typeof body.cin === 'string' && body.cin.trim()) {
        const verifyRes = await getCompanyVerificationProvider().verifyCompany(body.cin.trim());

        if (!verifyRes.success) {
          const field = 'cin';
          const msg = verifyRes.error?.message || 'Company verification failed via BizVerify.';
          return jsonResponse({
            valid: false,
            errors: [{ field, message: msg }],
            serviceUnavailable: verifyRes.error?.code === 'SERVICE_UNAVAILABLE',
            errorCode: verifyRes.error?.code,
          });
        }

        masterRecord = verifyRes.data ?? null;
      }

      const valRes = validateCompanyMasterData({
        cin: body.cin,
        companyName: body.companyName,
        entityType: body.entityType,
        incorporationDate: body.incorporationDate,
        stateCode: body.stateCode,
        roc: body.roc,
        masterRecord,
        existingCinsInDb,
        currentCompanyId: body.currentCompanyId,
      });

      return jsonResponse({
        valid: valRes.valid,
        errors: valRes.errors,
        masterRecord: valRes.masterRecord ?? null,
        verifiedBy: masterRecord ? 'BizVerify' : null,
      });
    }

    await getAuthContext(req);

    // GET /lookup-api/cin/:cin
    const cinMatch = path.match(/\/cin\/([^/]+)$/);
    if (req.method === 'GET' && cinMatch) {
      const cin = cinMatch[1].toUpperCase();
      const decoded = decodeCin(cin);
      if (!decoded) {
        throw new UnprocessableError('That is not a valid CIN. It should be 21 characters, e.g. U72900TN2020PTC138472.');
      }

      const verifyRes = await getCompanyVerificationProvider().verifyCompany(cin);

      return jsonResponse({
        cin,
        decoded,
        verified: verifyRes.success,
        verifiedBy: verifyRes.success ? 'BizVerify' : null,
        masterRecord: verifyRes.data ?? null,
        error: verifyRes.error ?? null,
      });
    }

    // GET /lookup-api/pan/:pan
    const panMatch = path.match(/\/pan\/([^/]+)$/);
    if (req.method === 'GET' && panMatch) {
      const pan = panMatch[1].toUpperCase();
      const decoded = decodePan(pan);
      if (!decoded) {
        throw new UnprocessableError('That is not a valid PAN. It should look like AAACT1234A.');
      }

      return jsonResponse({ decoded, derivedFrom: DERIVED_FROM });
    }

    // GET /lookup-api/gstin/:gstin
    const gstinMatch = path.match(/\/gstin\/([^/]+)$/);
    if (req.method === 'GET' && gstinMatch) {
      const gstin = gstinMatch[1].toUpperCase();
      const pan = url.searchParams.get('pan') || null;
      const result = validateGstin(gstin, pan);

      return jsonResponse({
        valid: result.valid,
        errors: result.errors,
        suggested: { stateCode: result.stateCode ?? null, pan: result.pan ?? null },
        derivedFrom: `${DERIVED_FROM} The check digit is verified; whether the registration is active is not.`,
      });
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
