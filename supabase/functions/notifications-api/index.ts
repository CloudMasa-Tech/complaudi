import { handleCors } from '../_shared/cors.ts';
import { getAuthContext, requireCapability } from '../_shared/auth.ts';
import { getAdminSupabase, getClientSupabase } from '../_shared/database.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { addDays, today, formatDate } from '../_shared/dates.ts';
import { sendEmail, reminderTemplate } from '../_shared/mailer.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authCtx = await getAuthContext(req);
    const url = new URL(req.url);
    const path = (url.pathname
      .replace(/^\/functions\/v1\/[^\/]+/, '')
      .replace(/^\/api\/v1\/[^\/]+/, '')
      .replace(/^\/[^\/]+-api/, '')
      .replace(/^\/notifications/, '') || '/');
    const client = getClientSupabase(req);
    const admin = getAdminSupabase();

    // GET /notifications-api
    if (req.method === 'GET' && (path === '' || path === '/' || path.endsWith('/notifications-api') || path.endsWith('/notifications-api/'))) {
      const page = parseInt(url.searchParams.get('page') || '1');
      const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

      let query = client
        .from('notifications')
        .select('*, complianceItem:compliance_items(id, title, dueDate, status, severity, authority)', { count: 'exact' })
        .eq('userId', authCtx.userId)
        .order('createdAt', { ascending: false });

      if (unreadOnly) {
        query = query.is('readAt', null);
      }

      const fromIdx = (page - 1) * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      query = query.range(fromIdx, toIdx);

      const { data, count, error } = await query;
      if (error) throw error;

      const { count: unreadCount } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('userId', authCtx.userId)
        .is('readAt', null);

      return jsonResponse({
        total: count || 0,
        unread: unreadCount || 0,
        page,
        pageSize,
        rows: data || [],
      });
    }

    // POST /notifications-api/read
    if (req.method === 'POST' && path.endsWith('/read')) {
      const body = await req.json();
      const ids: string[] = body.ids || [];
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new BadRequestError('ids array is required');
      }

      const { error } = await client
        .from('notifications')
        .update({ read: true, readAt: new Date().toISOString() })
        .eq('userId', authCtx.userId)
        .in('id', ids);

      if (error) throw error;
      return jsonResponse({ updated: ids.length });
    }

    // POST /notifications-api/read-all
    if (req.method === 'POST' && path.endsWith('/read-all')) {
      const { error } = await client
        .from('notifications')
        .update({ read: true, readAt: new Date().toISOString() })
        .eq('userId', authCtx.userId)
        .eq('read', false);

      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // POST /notifications-api/sweep
    if (req.method === 'POST' && path.endsWith('/sweep')) {
      requireCapability(authCtx, 'audit.read');

      const now = new Date();
      const threshold7 = addDays(today(), 7);

      const { data: items } = await admin
        .from('compliance_items')
        .select('id, title, dueDate, urgency, companyId, company:companies(legalName, organizationId)')
        .eq('company.organizationId', authCtx.organizationId)
        .eq('status', 'PENDING')
        .lte('dueDate', threshold7.toISOString());

      let createdCount = 0;
      let emailsSent = 0;

      for (const item of (items || [])) {
        const companyName = (item.company as any)?.legalName || 'Company';
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
            organizationId: authCtx.organizationId,
            userId: u.id,
            companyId: item.companyId,
            complianceItemId: item.id,
            title,
            message,
            read: false,
          });

          if (!insErr) {
            createdCount++;
            if (u.email) {
              const html = reminderTemplate(u.name || 'User', item.title, companyName, due);
              await sendEmail({ to: u.email, subject: title, html }).catch(() => null);
              emailsSent++;
            }
          }
        }
      }

      await admin.from('audit_logs').insert({
        organizationId: authCtx.organizationId,
        actorUserId: authCtx.userId,
        action: 'notifications.sweep',
        entityType: 'Notification',
        afterJson: { createdCount, emailsSent },
      });

      return jsonResponse({ createdCount, emailsSent });
    }

    throw new NotFoundError('Endpoint');
  } catch (err: any) {
    return errorResponse(err);
  }
});
