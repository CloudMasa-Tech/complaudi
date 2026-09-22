import { handleCors } from '../_shared/cors.ts';
import { getAuthContext } from '../_shared/auth.ts';
import { getClientSupabase } from '../_shared/database.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { today, formatDate } from '../_shared/dates.ts';
import { retrieveRules } from '../_shared/retrieval.ts';
import { evaluateRule } from '../_shared/engine/evaluator.ts';
import { inr } from '../_shared/engine/conditions.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function readableDate(isoStr: string): string {
  const [y, m, d] = isoStr.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const DISCLAIMER =
  'This is generated from the built-in rule engine and your recorded company profile. It is general guidance, not professional advice — confirm state-specific dates and edge cases with your chartered accountant or company secretary.';

function describeCompany(company: any): string {
  const bits = [
    (company.entityType || 'PRIVATE_LIMITED').replace(/_/g, ' ').toLowerCase(),
    `turnover ${inr(Number(company.annualTurnover || 0))}`,
    `${company.employeeCount || 0} employee${(company.employeeCount || 0) === 1 ? '' : 's'}`,
    `registered in ${company.stateCode || 'IN'}`,
  ];
  if (company.gstRegistrations?.length) bits.push(`${company.gstRegistrations.length} GST registration(s)`);
  if (company.msmeRegistration) bits.push('Udyam registered');
  return bits.join(', ');
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const client = getClientSupabase(req);

    // POST /copilot-api/ask
    if (req.method === 'POST' && path.endsWith('/ask')) {
      const body = await req.json();
      const { question, companyId } = body;
      if (!question || typeof question !== 'string' || question.length < 3) {
        throw new BadRequestError('Question must be at least 3 characters.');
      }

      const retrieved = retrieveRules(question);

      let company: any = null;
      let ctx: any = null;
      if (companyId) {
        const { data: comp } = await client
          .from('companies')
          .select('*, directors(*), gstRegistrations:gst_registrations(*), msmeRegistration:msme_registrations(*)')
          .eq('id', companyId)
          .maybeSingle();
        if (comp) {
          company = comp;
          ctx = {
            company: {
              id: comp.id,
              legalName: comp.legalName,
              entityType: comp.entityType || 'PRIVATE_LIMITED',
              annualTurnover: Number(comp.annualTurnover || 0),
              employeeCount: comp.employeeCount || 0,
              stateCode: comp.stateCode || '',
              paidUpCapital: Number(comp.paidUpCapital || 0),
              borrowings: Number(comp.borrowings || 0),
              isListed: comp.isListed || false,
              incorporationDate: comp.incorporationDate ? new Date(comp.incorporationDate) : new Date(),
              cin: comp.cin || null,
              llpin: comp.llpin || null,
              pan: comp.pan || null,
              tan: comp.tan || null,
              industry: comp.industry || null,
              cashTransactionRatioBelow5Pct: comp.cashTransactionRatioBelow5Pct || false,
              hasForeignTransactions: comp.hasForeignTransactions || false,
              acceptsDeposits: comp.acceptsDeposits || false,
              buysFromMsmeSuppliers: comp.buysFromMsmeSuppliers || false,
              agmDate: comp.agmDate ? new Date(comp.agmDate) : null,
              epfoCode: comp.epfoCode || null,
              esicCode: comp.esicCode || null,
              shopAndEstablishment: comp.shopAndEstablishment || null,
              professionalTax: comp.professionalTax || null,
            },
            directors: comp.directors || [],
            gstRegistrations: comp.gstRegistrations || [],
            msme: comp.msmeRegistration ? {
              udyamNumber: comp.msmeRegistration.udyamNumber || '',
              category: comp.msmeRegistration.category || 'MICRO',
              registeredOn: comp.msmeRegistration.registeredOn ? new Date(comp.msmeRegistration.registeredOn) : null,
            } : null,
          };
        }
      }

      const nextItems = company
        ? (
            await client
              .from('compliance_items')
              .select('ruleCode, dueDate, status')
              .eq('companyId', company.id)
              .in('ruleCode', retrieved.map((r: any) => r.rule.code))
              .not('status', 'in', '("COMPLETED","WAIVED")')
              .gte('dueDate', today().toISOString())
              .order('dueDate', { ascending: true })
          ).data || []
        : [];

      const nextByRule = new Map<string, { dueDate: string; status: string }>();
      for (const item of nextItems) {
        if (!nextByRule.has(item.ruleCode)) nextByRule.set(item.ruleCode, item);
      }

      const citations = retrieved.map(({ rule }: any) => {
        const evaluation = ctx ? evaluateRule(rule, ctx) : null;
        const next = nextByRule.get(rule.code);
        return {
          ruleCode: rule.code,
          title: rule.title,
          form: rule.form ?? null,
          authority: rule.authority,
          legalReference: rule.legalReference,
          severity: rule.severity,
          penalty: rule.penalty,
          appliesToThisCompany: evaluation ? evaluation.applicable : null,
          reasons: evaluation ? evaluation.reasons : null,
          nextDueDate: next ? formatDate(new Date(next.dueDate)) : null,
          nextDueStatus: next?.status ?? null,
        };
      });

      // Construct answer text
      const lines: string[] = [];
      if (retrieved.length === 0) {
        lines.push('I could not match that question to anything in the rule engine. Try naming a form (AOC-4, GSTR-3B, Form 11), an authority (MCA, GST, income tax, MSME, labour), or a topic such as "director KYC", "tax audit" or "provident fund".');
      } else {
        if (company) lines.push(`For ${company.legalName} — ${describeCompany(company)}:`, '');

        const top = retrieved[0];
        const topCitation = citations.find((c: any) => c.ruleCode === top.rule.code);
        const name = (c: any) =>
          c.form && !c.title.toLowerCase().includes(c.form.toLowerCase()) ? `${c.title} (${c.form})` : c.title;

        const detail = (c: any): string[] => {
          const out = [`• ${name(c)}`, `  ${c.legalReference} — ${c.severity.toLowerCase()} priority.`];
          if (c.nextDueDate) out.push(`  Next due ${readableDate(c.nextDueDate)} (currently ${c.nextDueStatus?.toLowerCase()}).`);
          out.push(`  If missed: ${c.penalty}`, '');
          return out;
        };

        const decidingReasons = (c: any): string[] =>
          (c.reasons ?? [])
            .filter((r: any) => (r.negated ? r.passed : !r.passed))
            .map((r: any) => (r.negated ? `Exempt because ${r.label.replace(/^Exempt: /, '')}` : `Not met: ${r.label}`));

        const applicable = citations.filter((c: any) => c.appliesToThisCompany !== false);
        const notApplicable = citations.filter((c: any) => c.appliesToThisCompany === false);

        if (topCitation && topCitation.appliesToThisCompany === false) {
          lines.push(`${name(topCitation)} does not apply${company ? ` to ${company.legalName}` : ''}.`);
          for (const reason of decidingReasons(topCitation)) lines.push(`  • ${reason}`);
          lines.push('');

          if (applicable.length > 0) {
            lines.push('Related obligations that do apply:', '');
            for (const c of applicable.slice(0, 3)) lines.push(...detail(c));
          }
        } else {
          for (const c of applicable.slice(0, 4)) lines.push(...detail(c));

          const others = notApplicable.filter((c: any) => c.ruleCode !== topCitation?.ruleCode);
          if (others.length > 0) {
            lines.push(`Also matched but not applicable to you: ${others.map((c: any) => c.title).join('; ')}.`, '');
          }
        }
      }

      const topScore = retrieved[0]?.score || 0;
      const confidence = topScore >= 12 ? 'high' : topScore >= 5 ? 'medium' : 'low';

      return jsonResponse({
        question,
        answer: lines.join('\n').trim(),
        citations,
        companyId: company?.id ?? null,
        provider: 'rule-grounded',
        confidence,
        disclaimer: DISCLAIMER,
      });
    }

    // GET /copilot-api/search
    if (req.method === 'GET' && path.endsWith('/search')) {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');

      if (!q || q.length < 2) throw new BadRequestError('Search query must be at least 2 characters.');

      const results = retrieveRules(q, limit).map(({ rule, score, matchedTerms }: any) => ({
        score: Math.round(score * 100) / 100,
        matchedTerms,
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
        periodKind: rule.periodKind,
      }));

      return jsonResponse(results);
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
