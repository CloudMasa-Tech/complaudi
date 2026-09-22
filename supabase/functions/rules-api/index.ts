import { handleCors } from '../_shared/cors.ts';
import { getAuthContext, requireCapability } from '../_shared/auth.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { NotFoundError } from '../_shared/errors.ts';
import { allRules, getRule, rulesByAuthority } from '../_shared/engine/catalog/index.ts';
import { applicableEntityTypes } from '../_shared/engine/entityApplicability.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    requireCapability(authCtx, 'rules.read');

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    // GET /rules-api/:code
    const codeMatch = path.match(/\/rules-api\/([^/]+)$/);
    if (req.method === 'GET' && codeMatch && codeMatch[1] !== 'rules-api') {
      const code = codeMatch[1].toUpperCase();
      const rule = getRule(code);
      if (!rule) throw new NotFoundError(`Rule ${code}`);

      return jsonResponse({
        code: rule.code,
        title: rule.title,
        authority: rule.authority,
        category: rule.category,
        form: rule.form ?? null,
        legalReference: rule.legalReference,
        description: rule.description,
        severity: rule.severity,
        penalty: rule.penalty,
        evidenceRequired: rule.evidenceRequired,
        evidenceLevel: rule.evidenceLevel,
        signatoryRequired: Boolean(rule.signatoryRequired),
        periodKind: rule.periodKind,
        entityTypes: applicableEntityTypes(rule),
        conditions: rule.applicableWhen.map((c: any) => c.label),
        exemptions: (rule.excludeWhen ?? []).map((c: any) => c.label),
      });
    }

    // GET /rules-api
    if (req.method === 'GET') {
      const authority = url.searchParams.get('authority') as any;
      const rules = authority ? rulesByAuthority(authority) : allRules;

      return jsonResponse(
        rules.map((r: any) => ({
          code: r.code,
          title: r.title,
          authority: r.authority,
          category: r.category,
          form: r.form ?? null,
          legalReference: r.legalReference,
          description: r.description,
          severity: r.severity,
          penalty: r.penalty,
          evidenceRequired: r.evidenceRequired,
          evidenceLevel: r.evidenceLevel,
          signatoryRequired: Boolean(r.signatoryRequired),
          periodKind: r.periodKind,
          entityTypes: applicableEntityTypes(r),
          conditions: r.applicableWhen.map((c: any) => c.label),
          exemptions: (r.excludeWhen ?? []).map((c: any) => c.label),
        }))
      );
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
