import { handleCors } from '../_shared/cors.ts';
import { getAuthContext } from '../_shared/auth.ts';
import { getClientSupabase, getAdminSupabase } from '../_shared/database.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { today, formatDate, addDays } from '../_shared/dates.ts';
import { computeComplianceScore } from '../_shared/engine/score.ts';
import { evaluateRegistrations } from '../_shared/engine/catalog/registrations.ts';
import { deriveDinStatus } from '../_shared/engine/dinStatus.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '') || '/');
    const client = getClientSupabase(req);
    const admin = getAdminSupabase();

    // GET /dashboard-api/score or GET /score
    if (req.method === 'GET' && (path.endsWith('/score') || path.endsWith('/dashboard-api/score'))) {
      const companyId = url.searchParams.get('companyId') || undefined;

      let query = client
        .from('compliance_items')
        .select('ruleCode, authority, severity, dueDate, status, completedAt, company:companies(createdAt)');

      if (companyId) {
        query = query.eq('companyId', companyId);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      const scorable = (rows || []).map((r: any) => ({
        ruleCode: r.ruleCode,
        authority: r.authority,
        severity: r.severity,
        dueDate: new Date(r.dueDate),
        status: r.status,
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
        onboardedAt: r.company?.createdAt ? new Date(r.company.createdAt) : null,
      }));

      const score = computeComplianceScore(scorable);
      return jsonResponse({ score });
    }

    // GET /dashboard-api/overview or GET /overview
    if (req.method === 'GET' && (path.endsWith('/overview') || path.endsWith('/dashboard-api/overview'))) {
      const companyId = url.searchParams.get('companyId') || undefined;

      let itemQuery = client
        .from('compliance_items')
        .select('id, title, ruleCode, authority, category, severity, dueDate, status, completedAt, evidenceLevel, attestationText, companyId, company:companies(id, legalName, createdAt)');

      if (companyId) {
        itemQuery = itemQuery.eq('companyId', companyId);
      }

      const { data: items, error: itemErr } = await itemQuery;
      if (itemErr) throw itemErr;

      const scorable = (items || []).map((r: any) => ({
        ruleCode: r.ruleCode,
        authority: r.authority,
        severity: r.severity,
        dueDate: new Date(r.dueDate),
        status: r.status,
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
        onboardedAt: r.company?.createdAt ? new Date(r.company.createdAt) : null,
      }));

      const score = computeComplianceScore(scorable);

      const { count: companyCount, error: compCountErr } = await client.from('companies').select('*', { count: 'exact', head: true });
      if (compCountErr) {
        console.error('[Dashboard] Error counting companies:', compCountErr);
      }

      const statusCounts: Record<string, number> = { PENDING: 0, COMPLETED: 0, OVERDUE: 0, WAIVED: 0 };
      const severityCounts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      const authMap = new Map<string, { authority: string; total: number; overdue: number; completed: number; upcoming: number }>();

      const now = today();
      const overdue: any[] = [];
      const dueSoon: any[] = [];

      let itemsRequiringEvidence = 0;
      let itemsWithEvidence = 0;

      for (const item of (items || [])) {
        statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
        severityCounts[item.severity] = (severityCounts[item.severity] || 0) + 1;

        let a = authMap.get(item.authority);
        if (!a) {
          a = { authority: item.authority, total: 0, overdue: 0, completed: 0, upcoming: 0 };
          authMap.set(item.authority, a);
        }
        a.total++;

        const dDate = new Date(item.dueDate);
        if (item.status === 'COMPLETED') {
          a.completed++;
        } else if (dDate < now) {
          a.overdue++;
          overdue.push(item);
        } else {
          a.upcoming++;
          if (dDate <= addDays(now, 14)) {
            dueSoon.push(item);
          }
        }

        itemsRequiringEvidence++;
        if (item.evidenceLevel !== 'NONE' || item.attestationText) itemsWithEvidence++;
      }

      let openTasksQuery = client.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'OPEN');
      let inProgressTasksQuery = client.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'IN_PROGRESS');
      let completedTasksQuery = client.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED');

      if (companyId) {
        openTasksQuery = openTasksQuery.eq('companyId', companyId);
        inProgressTasksQuery = inProgressTasksQuery.eq('companyId', companyId);
        completedTasksQuery = completedTasksQuery.eq('companyId', companyId);
      }

      const { count: openTasks, error: openErr } = await openTasksQuery;
      if (openErr) console.error('[Dashboard] Error counting open tasks:', openErr);

      const { count: inProgressTasks, error: inProgErr } = await inProgressTasksQuery;
      if (inProgErr) console.error('[Dashboard] Error counting in-progress tasks:', inProgErr);

      const { count: completedTasks, error: compErr } = await completedTasksQuery;
      if (compErr) console.error('[Dashboard] Error counting completed tasks:', compErr);

      let profile = null;
      let registrations: any[] = [];

      if (companyId) {
        const { data: comp, error: compFetchErr } = await client
          .from('companies')
          .select('*, directors(*), gstRegistrations:gst_registrations(*), msmeRegistration:msme_registrations(*)')
          .eq('id', companyId)
          .maybeSingle();

        if (compFetchErr) console.error('[Dashboard] Error fetching company details:', compFetchErr);

        if (comp) {
          const msmeReg = Array.isArray(comp.msmeRegistration) ? comp.msmeRegistration[0] || null : comp.msmeRegistration;
          const serving = (comp.directors || []).filter((d: any) => !d.resignedOn);

          // A DIN is deactivated for essentially one reason — DIR-3 KYC not
          // filed by 30 September — so the company's own record of that
          // obligation is what the director chips read.
          const { data: kycRows } = await client
            .from('compliance_items')
            .select('periodKey, dueDate, status, completedAt')
            .eq('companyId', companyId)
            .eq('ruleCode', 'MCA_DIR3KYC')
            .order('dueDate', { ascending: false });

          const kycFilings = (kycRows || []).map((k: any) => ({
            periodKey: k.periodKey,
            dueDate: new Date(k.dueDate),
            status: String(k.status),
            completedAt: k.completedAt ? new Date(k.completedAt) : null,
          }));
          const activeDsc = serving.filter((d: any) => d.dscExpiresOn && new Date(d.dscExpiresOn) >= now);

          profile = {
            id: comp.id,
            legalName: comp.legalName,
            entityType: comp.entityType,
            businessType: comp.businessType,
            industry: comp.industry,
            registrationLabel: comp.entityType === 'LLP' ? 'LLPIN' : comp.cin ? 'CIN' : 'PAN',
            registrationNumber: comp.llpin || comp.cin || comp.pan || null,
            incorporationDate: comp.incorporationDate ? formatDate(new Date(comp.incorporationDate)) : null,
            ageYears: comp.incorporationDate ? now.getFullYear() - new Date(comp.incorporationDate).getFullYear() : null,
            pan: comp.pan || null,
            annualTurnover: Number(comp.annualTurnover || 0),
            employeeCount: comp.employeeCount || 0,
            stateCode: comp.stateCode || null,
            directors: (serving || []).map((d: any) => ({
              id: d.id,
              name: d.name,
              din: d.din,
              designation: d.designation,
              dscExpiresOn: d.dscExpiresOn ? formatDate(new Date(d.dscExpiresOn)) : null,
              dscStatus: !d.dscExpiresOn ? 'NOT_RECORDED' : new Date(d.dscExpiresOn) >= now ? 'ACTIVE' : 'EXPIRED',
              // Inferred from the DIR-3 KYC record, never checked with MCA.
              dinStatus: deriveDinStatus(
                { din: d.din ?? null, resignedOn: d.resignedOn ? new Date(d.resignedOn) : null },
                kycFilings,
                now,
              ),
            })),
            msme: msmeReg && msmeReg.udyamNumber?.trim() ? { udyamNumber: msmeReg.udyamNumber.trim(), category: msmeReg.category, registeredOn: msmeReg.registeredOn } : null,
            gstins: (comp.gstRegistrations || []).map((g: any) => ({ gstin: g.gstin, stateCode: g.stateCode, isActive: g.isActive })),
            dpiit: comp.dpiitRecognitionNumber && comp.dpiitRecognitionNumber.trim() ? { number: comp.dpiitRecognitionNumber.trim(), recognisedOn: comp.dpiitRecognisedOn } : null,
            epfoCode: comp.epfoCode || null,
            esicCode: comp.esicCode || null,
            shopAndEstablishment: comp.shopAndEstablishment || null,
            fssai: comp.fssai || null,
            professionalTax: comp.professionalTax || null,
            tradeLicense: comp.tradeLicense || null,
            dsc: {
              status: activeDsc.length > 0 ? 'ACTIVE' : 'NOT_RECORDED',
              active: activeDsc.length,
              total: serving.length,
              nextExpiry: activeDsc[0]?.dscExpiresOn ? formatDate(new Date(activeDsc[0].dscExpiresOn)) : null,
            },
            mcaKyc: { status: 'NOT_DUE', dueDate: null, periodLabel: null },
          };

          registrations = evaluateRegistrations(profile);

          const registeredCount = registrations.filter((r: any) => r.status === 'REGISTERED').length;
          const mandatoryCount = registrations.filter((r: any) => r.status === 'MANDATORY' || r.status === 'EXPIRED_RENEWAL_DUE').length;
          const eligibleCount = registrations.filter((r: any) => r.status === 'ELIGIBLE' || r.status === 'PENDING_APPLICATION').length;
          
          console.log(`[Dashboard Registration Evaluation] Company: ${comp.legalName} (ID: ${companyId})`, {
            cin: comp.cin,
            constitutionType: comp.entityType,
            applicableCount: registrations.length,
            registeredCount,
            mandatoryCount,
            eligibleCount,
            score: `${registeredCount}/${registrations.length}`,
            registrations: registrations.map((r: any) => ({ id: r.id, title: r.title, status: r.status })),
          });
        }
      }

      return jsonResponse({
        score,
        companies: companyCount || 0,
        statusCounts,
        severityCounts,
        byAuthority: [...authMap.values()],
        overdue: overdue.slice(0, 10),
        dueSoon: dueSoon.slice(0, 10),
        registrations,
        taskCounts: { open: openTasks || 0, inProgress: inProgressTasks || 0, completed: completedTasks || 0 },
        evidence: {
          itemsRequiringEvidence,
          itemsWithEvidence,
          coveragePct: itemsRequiringEvidence > 0 ? Math.round((itemsWithEvidence / itemsRequiringEvidence) * 100) : 100,
        },
        profile,
      });
    }

    // GET /score/:id/history
    const historyMatch = path.match(/\/score\/([^/]+)\/history$/);
    if (req.method === 'GET' && historyMatch) {
      const companyId = historyMatch[1];
      const limit = parseInt(url.searchParams.get('limit') || '90');

      const { data, error } = await client
        .from('compliance_score_snapshots')
        .select('*')
        .eq('companyId', companyId)
        .order('createdAt', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return jsonResponse(data || []);
    }

    // POST /score/:id/snapshot
    const snapshotMatch = path.match(/\/score\/([^/]+)\/snapshot$/);
    if (req.method === 'POST' && snapshotMatch) {
      const companyId = snapshotMatch[1];

      const { data: rows } = await client
        .from('compliance_items')
        .select('ruleCode, authority, severity, dueDate, status, completedAt, company:companies(createdAt, organizationId)')
        .eq('companyId', companyId);

      const scorable = (rows || []).map((r: any) => ({
        ruleCode: r.ruleCode,
        authority: r.authority,
        severity: r.severity,
        dueDate: new Date(r.dueDate),
        status: r.status,
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
        onboardedAt: r.company?.createdAt ? new Date(r.company.createdAt) : null,
      }));

      const score = computeComplianceScore(scorable);
      const orgId = rows?.[0]?.company?.organizationId || authCtx.organizationId;

      const { data: snapshot, error: insErr } = await admin
        .from('compliance_score_snapshots')
        .insert({
          organizationId: orgId,
          companyId,
          score: score.score,
          band: score.band,
          assessed: score.assessed,
          onTime: score.onTime,
          late: score.late,
          missed: score.missed,
          byAuthorityJson: score.byAuthority,
        })
        .select('*')
        .single();

      if (insErr) throw insErr;
      return jsonResponse(snapshot, 201);
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
