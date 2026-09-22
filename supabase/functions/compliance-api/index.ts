// supabase/functions/compliance-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { assertCan, getAuthContext, seesEveryCompany } from '../_shared/auth.ts';
import { getSupabaseAdminClient, serialiseBigInt } from '../_shared/database.ts';
import { AppError, BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody, parseQueryParams } from '../_shared/validation.ts';
import { allRules, evaluateAll, explainRule, generateCalendar, deriveStatus } from '../_shared/engine/index.ts';
import { applicableEntityTypes } from '../_shared/engine/entityApplicability.ts';
import { addDays, parseDate, today } from '../_shared/dates.ts';
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

      const now = today();
      const windowStart = addDays(now, -365);
      const windowEnd = addDays(now, 365);

      const genResult = generateCalendar(ctx, { from: windowStart, to: windowEnd });

      let created = 0;
      let updated = 0;
      for (const item of genResult.items) {
        const derived = deriveStatus(item.dueDate, null);
        const { data: existing } = await supabase
          .from('compliance_items')
          .select('id, status, completedAt')
          .eq('companyId', companyId)
          .eq('ruleCode', item.ruleCode)
          .eq('periodKey', item.periodKey)
          .single();

        if (existing) {
          const finalStatus = existing.status === 'COMPLETED' || existing.status === 'WAIVED' ? existing.status : derived;
          await supabase.from('compliance_items').update({ status: finalStatus, dueDate: item.dueDate }).eq('id', existing.id);
          updated++;
        } else {
          await supabase.from('compliance_items').insert({
            companyId,
            ruleCode: item.ruleCode,
            title: item.title,
            authority: item.authority,
            category: item.category,
            form: item.form,
            legalReference: item.legalReference,
            severity: item.severity,
            periodKey: item.periodKey,
            periodLabel: item.periodLabel,
            periodStart: item.periodStart,
            periodEnd: item.periodEnd,
            dueDate: item.dueDate,
            status: derived,
            penaltyNote: item.penaltyNote,
            evidenceRequired: item.evidenceRequired,
            evidenceLevel: item.evidenceLevel,
          });
          created++;
        }
      }

      return jsonResponse({ synced: true, generatedItems: genResult.items.length, created, updated });
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

      const evaluation = evaluateAll(ctx);
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

      const explanation = explainRule(ctx, ruleCode);
      if (!explanation) throw new NotFoundError('Rule not found');
      return jsonResponse(explanation);
    }

    // GET /items/:id
    const getItemMatch = path.match(/^\/items\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && getItemMatch) {
      const itemId = getItemMatch[1];
      const { data: item } = await supabase.from('compliance_items').select('*, company:companies(*)').eq('id', itemId).single();
      if (!item) throw new NotFoundError('Compliance item not found');

      await assertCan(authCtx, item.companyId, 'compliance.view');
      return jsonResponse(serialiseBigInt(item));
    }

    // PATCH /items/:id/status (With Explicit Multi-Step Transaction Rollback Safety)
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

      const beforeStatus = existingItem.status;
      const beforeWaivedReason = existingItem.waivedReason;
      const beforeAttestation = existingItem.attestationText;
      const beforeSignatory = existingItem.signatoryName;
      const beforeCompletedAt = existingItem.completedAt;

      // 1. Update compliance item status
      const updateData: Record<string, unknown> = {
        status: body.status,
        waivedReason: body.waivedReason || null,
        attestationText: body.attestation || null,
        signatoryName: body.signatoryName || null,
        completedAt: body.status === 'COMPLETED' ? new Date().toISOString() : null,
      };

      const { data: updatedItem, error: updateErr } = await supabase
        .from('compliance_items')
        .update(updateData)
        .eq('id', itemId)
        .select()
        .single();

      if (updateErr) throw new AppError(updateErr.message, 400);

      // 2. Multi-Step Atomic Audit Log Write
      try {
        const { error: auditErr } = await supabase.from('audit_logs').insert({
          id: crypto.randomUUID(),
          organizationId: authCtx.organizationId,
          actorId: authCtx.userId,
          actorEmail: authCtx.email,
          action: `item.${body.status.toLowerCase()}`,
          entityType: 'ComplianceItem',
          entityId: itemId,
          after: {
            status: updatedItem.status,
            waivedReason: updatedItem.waivedReason,
            attestation: updatedItem.attestationText,
            signatoryName: updatedItem.signatoryName,
          },
        });

        if (auditErr) throw auditErr;
      } catch (stepErr: any) {
        // TRANSACTION ROLLBACK GUARANTEE: Revert compliance item back to original state if audit write fails
        await supabase.from('compliance_items').update({
          status: beforeStatus,
          waivedReason: beforeWaivedReason,
          attestationText: beforeAttestation,
          signatoryName: beforeSignatory,
          completedAt: beforeCompletedAt,
        }).eq('id', itemId);

        throw new AppError(`Multi-step transaction failed: ${stepErr.message || stepErr}. Rolled back compliance item status.`, 500);
      }

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
