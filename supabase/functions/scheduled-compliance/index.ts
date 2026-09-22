import { handleCors } from '../_shared/cors.ts';
import { getAdminSupabase } from '../_shared/database.ts';
import { env } from '../_shared/env.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError, UnauthorizedError, ForbiddenError } from '../_shared/errors.ts';
import { today, formatDate, addDays } from '../_shared/dates.ts';
import { computeComplianceScore } from '../_shared/engine/score.ts';
import { sendEmail, reminderTemplate } from '../_shared/mailer.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const jobSecret = req.headers.get('x-job-secret');
    if (!env.JOB_TRIGGER_SECRET) {
      throw new ForbiddenError('The job trigger is disabled. Set JOB_TRIGGER_SECRET to enable it.');
    }
    if (jobSecret !== env.JOB_TRIGGER_SECRET) {
      throw new UnauthorizedError('Invalid job secret');
    }

    const admin = getAdminSupabase();
    const now = today();
    const scheduledForIso = now.toISOString().slice(0, 10);

    const body = await req.json().catch(() => ({}));
    const force = Boolean(body.force);

    if (!force) {
      const { data: existing } = await admin
        .from('job_runs')
        .select('*')
        .eq('jobName', 'daily-compliance')
        .eq('scheduledFor', scheduledForIso)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'SUCCEEDED' || existing.status === 'RUNNING') {
          return jsonResponse({ ran: false, reason: existing.status === 'SUCCEEDED' ? 'already-succeeded' : 'already-claimed', jobRunId: existing.id });
        }
      }
    }

    const jobRunId = crypto.randomUUID();
    const instanceId = `edge-function/${jobRunId.slice(0, 8)}`;

    const { error: claimErr } = await admin.from('job_runs').insert({
      id: jobRunId,
      jobName: 'daily-compliance',
      scheduledFor: scheduledForIso,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      claimedBy: instanceId,
    });

    if (claimErr && !force) {
      return jsonResponse({ ran: false, reason: 'already-claimed', jobRunId: null });
    }

    const startTime = Date.now();

    try {
      // 1. Refresh statuses
      const { data: overdueItems } = await admin
        .from('compliance_items')
        .select('id')
        .eq('status', 'PENDING')
        .lt('dueDate', scheduledForIso);

      if (overdueItems && overdueItems.length > 0) {
        await admin
          .from('compliance_items')
          .update({ status: 'OVERDUE' })
          .in('id', overdueItems.map((i: any) => i.id));
      }

      // 2. Reminder sweep
      const threshold7 = addDays(now, 7);
      const { data: items } = await admin
        .from('compliance_items')
        .select('id, title, dueDate, urgency, companyId, company:companies(legalName, organizationId)')
        .eq('status', 'PENDING')
        .lte('dueDate', threshold7.toISOString());

      let remindersCount = 0;
      for (const item of (items || [])) {
        const companyName = (item.company as any)?.legalName || 'Company';
        const orgId = (item.company as any)?.organizationId;
        const due = formatDate(new Date(item.dueDate));
        const title = `Compliance Due Soon: ${item.title}`;
        const message = `${item.title} for ${companyName} is due on ${due}. Please complete and submit evidence.`;

        const { data: members } = await admin
          .from('company_memberships')
          .select('userId, user:users(id, email, name)')
          .eq('companyId', item.companyId);

        for (const m of (members || [])) {
          const u = (m as any).user;
          if (!u) continue;

          const { error: insErr } = await admin.from('notifications').insert({
            organizationId: orgId,
            userId: u.id,
            companyId: item.companyId,
            complianceItemId: item.id,
            title,
            message,
            read: false,
          });

          if (!insErr) {
            remindersCount++;
            if (u.email) {
              const html = reminderTemplate(u.name || 'User', item.title, companyName, due);
              await sendEmail({ to: u.email, subject: title, html }).catch(() => null);
            }
          }
        }
      }

      // 3. Score snapshots
      const { data: companies } = await admin.from('companies').select('id, organizationId, createdAt');
      let snapshotCount = 0;

      for (const company of (companies || [])) {
        const { data: cItems } = await admin
          .from('compliance_items')
          .select('ruleCode, authority, severity, dueDate, status, completedAt')
          .eq('companyId', company.id);

        const scorable = (cItems || []).map((r: any) => ({
          ruleCode: r.ruleCode,
          authority: r.authority,
          severity: r.severity,
          dueDate: new Date(r.dueDate),
          status: r.status,
          completedAt: r.completedAt ? new Date(r.completedAt) : null,
          onboardedAt: company.createdAt ? new Date(company.createdAt) : null,
        }));

        const score = computeComplianceScore(scorable);

        await admin.from('compliance_score_snapshots').insert({
          organizationId: company.organizationId,
          companyId: company.id,
          score: score.score,
          band: score.band,
          assessed: score.assessed,
          onTime: score.onTime,
          late: score.late,
          missed: score.missed,
          byAuthorityJson: score.byAuthority,
        });

        snapshotCount++;
      }

      const durationMs = Date.now() - startTime;
      const result = {
        statusesUpdated: overdueItems?.length || 0,
        remindersSent: remindersCount,
        snapshotsCreated: snapshotCount,
      };

      await admin.from('job_runs').update({
        status: 'SUCCEEDED',
        finishedAt: new Date().toISOString(),
        durationMs,
        result,
      }).eq('id', jobRunId);

      return jsonResponse({ ran: true, jobRunId, durationMs, result });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await admin.from('job_runs').update({
        status: 'FAILED',
        finishedAt: new Date().toISOString(),
        durationMs,
        error: String(err?.message || err).slice(0, 2000),
      }).eq('id', jobRunId);
      throw err;
    }
  } catch (err: any) {
    return errorResponse(err);
  }
});


