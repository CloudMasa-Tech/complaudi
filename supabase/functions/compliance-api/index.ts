// supabase/functions/compliance-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { assertCan, getAuthContext, seesEveryCompany } from '../_shared/auth.ts';
import { getSupabaseAdminClient, serialiseBigInt } from '../_shared/database.ts';
import { AppError, BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody, parseQueryParams } from '../_shared/validation.ts';
import { allRules, evaluateAll, explainRule } from '../_shared/engine/index.ts';
import { applicableEntityTypes } from '../_shared/engine/entityApplicability.ts';
import { addDays, parseDate, today } from '../_shared/dates.ts';
import { applyItemStatusChange } from '../_shared/completion.ts';
import { syncCompanyCalendar } from '../_shared/sync.ts';
// @ts-ignore
import { z } from 'https://esm.sh/zod@3.23.8';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/^\/compliance/, '') || '/');
    const supabase = getSupabaseAdminClient();
    const authCtx = await getAuthContext(req);

    // GET /calendar
    if (req.method === 'GET' && path === '/calendar') {
      const schema = z.object({
        companyId: z.string().uuid().optional(),
        authority: z.enum(['MCA', 'GST', 'INCOME_TAX', 'MSME', 'LABOUR']).optional(),
        status: z.string().optional(),
        search: z.string().optional(),
        page: z.coerce.number().default(1),
        pageSize: z.coerce.number().default(50),
      });
      const queryParams = parseQueryParams(req.url, schema);

      let query = supabase.from('compliance_items').select('*, company:companies(id, legalName, entityType)', { count: 'exact' });

      if (queryParams.companyId) {
        await assertCan(authCtx, queryParams.companyId, 'compliance.view');
        query = query.eq('companyId', queryParams.companyId);
      } else if (!seesEveryCompany(authCtx.role)) {
        const { data: userGrants } = await supabase.from('company_memberships').select('companyId').eq('userId', authCtx.userId);
        const companyIds = (userGrants || []).map((g) => g.companyId);
        query = query.in('companyId', companyIds);
      }

      if (queryParams.authority) query = query.eq('authority', queryParams.authority);
      if (queryParams.status) query = query.in('status', queryParams.status.split(','));

      const fromIdx = (queryParams.page - 1) * queryParams.pageSize;
      const toIdx = fromIdx + queryParams.pageSize - 1;
      query = query.range(fromIdx, toIdx).order('dueDate', { ascending: true });

      const { data: items, count, error } = await query;
      if (error) throw new AppError(error.message, 400);

      const rows = serialiseBigInt(items || []);
      return jsonResponse({
        total: count || rows.length,
        page: queryParams.page,
        pageSize: queryParams.pageSize,
        rows,
      });
    }

    // GET /calendar/by-month
    if (req.method === 'GET' && path === '/calendar/by-month') {
      const companyId = url.searchParams.get('companyId');
      if (!companyId) throw new BadRequestError('companyId is required');

      await assertCan(authCtx, companyId, 'compliance.view');

      const { data: items, error } = await supabase
        .from('compliance_items')
        .select('*')
        .eq('companyId', companyId)
        .order('dueDate', { ascending: true });

      if (error) throw new AppError(error.message, 400);

      const byMonth = new Map<string, typeof items>();
      for (const item of (items || [])) {
        const monthKey = item.dueDate ? item.dueDate.slice(0, 7) : 'other';
        const list = byMonth.get(monthKey) || [];
        list.push(item);
        byMonth.set(monthKey, list);
      }

      const result = Array.from(byMonth.entries()).map(([month, items]) => ({
        month,
        items: serialiseBigInt(items),
      }));

      return jsonResponse(result);
    }

    // POST /companies/:id/sync (Engine Execution)
    const syncMatch = path.match(/^\/companies\/([a-f0-9-]+)\/sync$/);
    if (req.method === 'POST' && syncMatch) {
      const companyId = syncMatch[1];
      await assertCan(authCtx, companyId, 'company.edit');

      // The body of this used to live here in full. It is shared now, because
      // the endpoints that change a company's profile need to run exactly the
      // same regeneration, and two copies of it would drift.
      return jsonResponse(await syncCompanyCalendar(supabase, companyId));
    }

    // GET /companies/:id/applicability
    const applicabilityMatch = path.match(/^\/companies\/([a-f0-9-]+)\/applicability$/);
    if (req.method === 'GET' && applicabilityMatch) {
      const companyId = applicabilityMatch[1];
      await assertCan(authCtx, companyId, 'compliance.view');

      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('*, directors(*), gstRegistrations:gst_registrations(*), msme:msme_registrations(*)')
        .eq('id', companyId)
        .single();

      if (companyErr || !company) throw new NotFoundError('Company not found');

      const ctx = {
        company: {
          ...company,
          annualTurnover: Number(company.annualTurnover || 0),
          paidUpCapital: Number(company.paidUpCapital || 0),
          incorporationDate: company.incorporationDate ? parseDate(company.incorporationDate) : null,
          agmDate: company.agmDate ? parseDate(company.agmDate) : null,
        },
        directors: (company.directors || []).map((d: any) => ({
          ...d,
          appointedOn: d.appointedOn ? parseDate(d.appointedOn) : null,
          resignedOn: d.resignedOn ? parseDate(d.resignedOn) : null,
        })),
        gstRegistrations: company.gstRegistrations || [],
        msme: company.msme ? { ...company.msme, registeredOn: company.msme.registeredOn ? parseDate(company.msme.registeredOn) : null } : null,
      };

      // evaluateAll returns RuleEvaluation[] — `{ rule, applicable, reasons }`,
      // with everything about the rule nested under `.rule`. The client expects
      // it flattened (ruleCode, title, authority, category, severity, form),
      // which is what the Express API returns from listApplicability. Sending
      // the raw shape left every one of those undefined, so the drawer rendered
      // bare condition labels with no rule title, authority tag or severity —
      // which reads as "the wrong rules apply" when the evaluation was right.
      const evaluation = evaluateAll(ctx)
        .map((e: any) => ({
          ruleCode: e.rule.code,
          applicable: e.applicable,
          reasons: e.reasons,
          evaluatedAt: new Date().toISOString(),
          title: e.rule.title,
          authority: e.rule.authority,
          category: e.rule.category,
          severity: e.rule.severity,
          form: e.rule.form ?? null,
        }))
        // Applicable first, then by code — the same order listApplicability uses.
        .sort((a: any, b: any) =>
          Number(b.applicable) - Number(a.applicable) || a.ruleCode.localeCompare(b.ruleCode));

      return jsonResponse(evaluation);
    }

    // GET /companies/:id/explain/:ruleCode
    const explainMatch = path.match(/^\/companies\/([a-f0-9-]+)\/explain\/([^/]+)$/);
    if (req.method === 'GET' && explainMatch) {
      const companyId = explainMatch[1];
      const ruleCode = explainMatch[2].toUpperCase();
      await assertCan(authCtx, companyId, 'compliance.view');

      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('*, directors(*), gstRegistrations:gst_registrations(*), msme:msme_registrations(*)')
        .eq('id', companyId)
        .single();

      if (companyErr || !company) throw new NotFoundError('Company not found');

      const ctx = {
        company: {
          ...company,
          annualTurnover: Number(company.annualTurnover || 0),
          paidUpCapital: Number(company.paidUpCapital || 0),
          incorporationDate: company.incorporationDate ? parseDate(company.incorporationDate) : null,
          agmDate: company.agmDate ? parseDate(company.agmDate) : null,
        },
        directors: (company.directors || []).map((d: any) => ({
          ...d,
          appointedOn: d.appointedOn ? parseDate(d.appointedOn) : null,
          resignedOn: d.resignedOn ? parseDate(d.resignedOn) : null,
        })),
        gstRegistrations: company.gstRegistrations || [],
        msme: company.msme ? { ...company.msme, registeredOn: company.msme.registeredOn ? parseDate(company.msme.registeredOn) : null } : null,
      };

      const explanation = explainRule(ruleCode, ctx);
      if (!explanation) throw new NotFoundError('Rule not found');
      return jsonResponse(explanation);
    }

    // GET /items/:id
    const getItemMatch = path.match(/^\/items\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && getItemMatch) {
      const itemId = getItemMatch[1];
      // The drawer reads the evidence list and the task off this payload, so the
      // relations have to travel with the item: without them the client gets
      // `documents: undefined` and white-screens the moment a task is opened.
      // Same shape as the Node API's getItemOrThrow.
      const { data: item, error: itemErr } = await supabase
        .from('compliance_items')
        .select(
          '*, company:companies(*), documents(*, uploadedBy:users(id, name, email)), tasks(*, assignee:users(id, name, email))',
        )
        .eq('id', itemId)
        .single();
      if (itemErr) throw new AppError(itemErr.message, 400);
      if (!item) throw new NotFoundError('Compliance item not found');

      await assertCan(authCtx, item.companyId, 'compliance.view');

      // PostgREST embeds the reverse one-to-one as a list. The drawer wants the
      // task itself, and the client types it as one.
      const { tasks, ...rest } = item as Record<string, unknown> & { tasks?: unknown[] };
      return jsonResponse(serialiseBigInt({ ...rest, documents: item.documents || [], task: tasks?.[0] ?? null }));
    }

    // PATCH /items/:id/status
    //
    // The gate, the task sync and the audit write all live in _shared/completion
    // so they can be tested without a database. Marking an obligation complete is
    // a statutory claim: it is refused with 422 unless the work was owned, worked
    // through, evidenced and — where a human signs — attributed.
    const itemStatusMatch = path.match(/^\/items\/([a-f0-9-]+)\/status$/);
    if (req.method === 'PATCH' && itemStatusMatch) {
      const itemId = itemStatusMatch[1];
      const schema = z.object({
        status: z.enum(['UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'WAIVED']),
        waivedReason: z.string().optional().nullable(),
        attestation: z.string().optional().nullable(),
        signatoryName: z.string().optional().nullable(),
      });
      const body = await parseJsonBody(req, schema);

      const { data: existingItem } = await supabase.from('compliance_items').select('*').eq('id', itemId).single();
      if (!existingItem) throw new NotFoundError('Compliance item not found');

      await assertCan(authCtx, existingItem.companyId, 'compliance.update');

      const { item: updatedItem } = await applyItemStatusChange(supabase, {
        itemId,
        status: body.status,
        waivedReason: body.waivedReason,
        attestation: body.attestation,
        signatoryName: body.signatoryName,
        actorId: authCtx.userId,
        email: authCtx.email,
        organizationId: authCtx.organizationId,
      });

      return jsonResponse(serialiseBigInt(updatedItem));
    }

    // POST /refresh-statuses
    if (req.method === 'POST' && path === '/refresh-statuses') {
      const now = today().toISOString().split('T')[0];
      const soon = addDays(today(), 7).toISOString().split('T')[0];

      // OVERDUE: dueDate < now and status in UPCOMING, DUE, OVERDUE and completedAt is null
      const { data: overdueData } = await supabase
        .from('compliance_items')
        .update({ status: 'OVERDUE' })
        .in('status', ['UPCOMING', 'DUE', 'OVERDUE'])
        .is('completedAt', null)
        .lt('dueDate', now)
        .select('id');

      // DUE: dueDate >= now AND dueDate <= soon and status in UPCOMING, DUE, OVERDUE and completedAt is null
      const { data: dueData } = await supabase
        .from('compliance_items')
        .update({ status: 'DUE' })
        .in('status', ['UPCOMING', 'DUE', 'OVERDUE'])
        .is('completedAt', null)
        .gte('dueDate', now)
        .lte('dueDate', soon)
        .select('id');

      // UPCOMING: dueDate > soon and status in UPCOMING, DUE, OVERDUE and completedAt is null
      const { data: upcomingData } = await supabase
        .from('compliance_items')
        .update({ status: 'UPCOMING' })
        .in('status', ['UPCOMING', 'DUE', 'OVERDUE'])
        .is('completedAt', null)
        .gt('dueDate', soon)
        .select('id');

      return jsonResponse({
        due: dueData?.length || 0,
        overdue: overdueData?.length || 0,
        upcoming: upcomingData?.length || 0,
      });
    }

    throw new BadRequestError(`No route matches ${req.method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
});
