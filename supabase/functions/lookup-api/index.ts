import { handleCors } from '../_shared/cors.ts';
import { getAuthContext } from '../_shared/auth.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { UnprocessableError, NotFoundError } from '../_shared/errors.ts';
import { decodeCin, decodePan, validateGstin } from '../_shared/india.ts';

const DERIVED_FROM = 'Derived from the identifier itself — no government service was contacted.';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    await getAuthContext(req);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    // GET /lookup-api/cin/:cin
    const cinMatch = path.match(/\/cin\/([^/]+)$/);
    if (req.method === 'GET' && cinMatch) {
      const cin = cinMatch[1].toUpperCase();
      const decoded = decodeCin(cin);
      if (!decoded) {
        throw new UnprocessableError('That is not a valid CIN. It should be 21 characters, e.g. U72900TN2020PTC138472.');
      }

      return jsonResponse({
        decoded,
        suggested: {
          entityType: decoded.entityType,
          stateCode: decoded.stateCode,
          isListed: decoded.listed,
          industry: decoded.industry,
          incorporationYear: decoded.incorporationYear,
        },
        derivedFrom: DERIVED_FROM,
        notAvailable: [
          { field: 'legalName', why: 'Held by MCA, not encoded in the CIN.' },
          { field: 'incorporationDate', why: 'The CIN carries the year only, not the day or month.' },
          { field: 'pan', why: 'Not encoded in the CIN. It is encoded in a GSTIN.' },
          { field: 'directors', why: 'Held by MCA against the DIN register.' },
          { field: 'paidUpCapital', why: 'Held by MCA and changes with every allotment.' },
        ],
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
