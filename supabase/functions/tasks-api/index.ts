// supabase/functions/tasks-api/index.ts
import { handleCors } from '../_shared/cors.ts';
import { reopenItemForTask } from '../_shared/completion.ts';
import { assertCan, getAuthContext, seesEveryCompany } from '../_shared/auth.ts';
import { getSupabaseAdminClient, serialiseBigInt } from '../_shared/database.ts';
import { AppError, BadRequestError, NotFoundError } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/response.ts';
import { parseJsonBody, parseQueryParams } from '../_shared/validation.ts';
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
      .replace(/^\/tasks/, '') || '/');
    const supabase = getSupabaseAdminClient();
    const authCtx = await getAuthContext(req);

    // GET /tasks
    if (req.method === 'GET' && (path === '' || path === '/')) {
      const schema = z.object({
        companyId: z.string().uuid().optional(),
        status: z.string().optional(),
        assigneeId: z.string().uuid().optional(),
        page: z.coerce.number().default(1),
        pageSize: z.coerce.number().default(50),
      });
      const q = parseQueryParams(req.url, schema);

      let query = supabase.from('tasks').select('*, assignee:users(id, name, email), complianceItem:compliance_items(*)', { count: 'exact' });

      if (q.companyId) {
        await assertCan(authCtx, q.companyId, 'tasks.view');
        query = query.eq('companyId', q.companyId);
      } else if (!seesEveryCompany(authCtx.role)) {
        const { data: userGrants } = await supabase.from('company_memberships').select('companyId').eq('userId', authCtx.userId);
        const companyIds = (userGrants || []).map((g) => g.companyId);
        query = query.in('companyId', companyIds);
      }

      if (q.status) query = query.in('status', q.status.split(','));
      if (q.assigneeId) query = query.eq('assigneeId', q.assigneeId);

      const fromIdx = (q.page - 1) * q.pageSize;
      const toIdx = fromIdx + q.pageSize - 1;
      query = query.range(fromIdx, toIdx).order('dueDate', { ascending: true });

      const { data: tasks, count, error } = await query;
      if (error) throw new AppError(error.message, 400);

      const rows = serialiseBigInt(tasks || []);
      return jsonResponse({
        total: count || rows.length,
        page: q.page,
        pageSize: q.pageSize,
        rows,
      });
    }

    // POST /tasks (Create Task)
    if (req.method === 'POST' && (path === '' || path === '/')) {
      const schema = z.object({
        companyId: z.string().uuid(),
        title: z.string().min(2).max(160),
        description: z.string().optional().nullable(),
        assigneeId: z.string().uuid().optional().nullable(),
        dueDate: z.string(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
      });
      const body = await parseJsonBody(req, schema);

      await assertCan(authCtx, body.companyId, 'tasks.manage');

      const taskId = crypto.randomUUID();
      const { data: newTask, error } = await supabase
        .from('tasks')
        .insert({
          id: taskId,
          organizationId: authCtx.organizationId,
          companyId: body.companyId,
          title: body.title,
          description: body.description || null,
          assigneeId: body.assigneeId || null,
          dueDate: body.dueDate,
          priority: body.priority,
          status: 'TODO',
          createdById: authCtx.userId,
        })
        .select('*, assignee:users(id, name, email)')
        .single();

      if (error) throw new AppError(error.message, 400);

      // Audit Log
      await supabase.from('audit_logs').insert({
        organizationId: authCtx.organizationId,
        actorId: authCtx.userId,
        actorEmail: authCtx.email,
        action: 'task.create',
        entityType: 'Task',
        entityId: taskId,
        after: newTask,
      });

      return jsonResponse(serialiseBigInt(newTask), 201);
    }

    // GET /tasks/assignable
    if (req.method === 'GET' && path === '/assignable') {
      const companyId = url.searchParams.get('companyId');
      if (companyId) {
        await assertCan(authCtx, companyId, 'tasks.view');
      }

      const { data: users, error } = await supabase
        .from('users')
        .select('id, name, role, email')
        .eq('organizationId', authCtx.organizationId);

      if (error) throw new AppError(error.message, 400);
      return jsonResponse(users || []);
    }

    // GET /tasks/workload
    if (req.method === 'GET' && path === '/workload') {
      const companyId = url.searchParams.get('companyId');
      let query = supabase.from('tasks').select('id, status, assignee:users(id, name)');

      if (companyId) {
        await assertCan(authCtx, companyId, 'tasks.view');
        query = query.eq('companyId', companyId);
      }

      const { data: tasksList, error } = await query;
      if (error) throw new AppError(error.message, 400);

      const workloadMap = new Map<string, { assignee: { id: string; name: string } | null; counts: Record<string, number>; total: number }>();
      for (const t of (tasksList || [])) {
        const key = t.assignee?.id || 'unassigned';
        let entry = workloadMap.get(key);
        if (!entry) {
          entry = { assignee: t.assignee || null, counts: {}, total: 0 };
          workloadMap.set(key, entry);
        }
        entry.counts[t.status] = (entry.counts[t.status] || 0) + 1;
        entry.total++;
      }

      return jsonResponse([...workloadMap.values()]);
    }

    // GET /tasks/mine
    if (req.method === 'GET' && path === '/mine') {
      const page = parseInt(url.searchParams.get('page') || '1');
      const pageSize = parseInt(url.searchParams.get('pageSize') || '50');

      const fromIdx = (page - 1) * pageSize;
      const toIdx = fromIdx + pageSize - 1;

      const { data: tasks, count, error } = await supabase
        .from('tasks')
        .select('*, complianceItem:compliance_items(*)', { count: 'exact' })
        .eq('assigneeId', authCtx.userId)
        .in('status', ['TODO', 'IN_PROGRESS', 'BLOCKED'])
        .range(fromIdx, toIdx)
        .order('dueDate', { ascending: true });

      if (error) throw new AppError(error.message, 400);
      const rows = serialiseBigInt(tasks || []);
      return jsonResponse({
        total: count || rows.length,
        page,
        pageSize,
        rows,
      });
    }

    // POST /tasks/bulk-assign
    if (req.method === 'POST' && path === '/bulk-assign') {
      const schema = z.object({
        taskIds: z.array(z.string().uuid()).min(1).max(500),
        assigneeId: z.string().uuid().nullable(),
      });
      const body = await parseJsonBody(req, schema);

      const { error } = await supabase
        .from('tasks')
        .update({ assigneeId: body.assigneeId })
        .in('id', body.taskIds);

      if (error) throw new AppError(error.message, 400);
      return jsonResponse({ updated: body.taskIds.length });
    }

    // Single Task operations
    const taskIdMatch = path.match(/^\/([a-f0-9-]+)$/);
    if (taskIdMatch) {
      const taskId = taskIdMatch[1];
      const { data: existingTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
      if (!existingTask) throw new NotFoundError('Task not found');

      await assertCan(authCtx, existingTask.companyId, 'tasks.view');

      // GET /tasks/:id
      if (req.method === 'GET') {
        const { data: task, error } = await supabase
          .from('tasks')
          .select('*, assignee:users(id, name, email), complianceItem:compliance_items(*)')
          .eq('id', taskId)
          .single();

        if (error || !task) throw new NotFoundError('Task not found');
        return jsonResponse(serialiseBigInt(task));
      }

      // PATCH /tasks/:id
      if (req.method === 'PATCH') {
        await assertCan(authCtx, existingTask.companyId, 'tasks.manage');

        const schema = z.object({
          status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
          assigneeId: z.string().uuid().nullable().optional(),
          notes: z.string().optional().nullable(),
          description: z.string().optional().nullable(),
          checklist: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() })).optional(),
        });
        const body = await parseJsonBody(req, schema);

        const updateData: Record<string, unknown> = { ...body };
        if (body.status === 'DONE') updateData.completedAt = new Date().toISOString();
        // Moving away from DONE clears the completion the task was carrying.
        else if (existingTask.status === 'DONE' && body.status !== undefined) updateData.completedAt = null;

        const { data: updatedTask, error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', taskId)
          .select('*, assignee:users(id, name, email)')
          .single();

        if (error) throw new AppError(error.message, 400);

        // Reopening the work reopens the filing: an obligation must never read
        // COMPLETED while the task behind it has been pulled back open.
        // Marking a task DONE still does not file the obligation — that stays a
        // separate, gated act (compliance-api PATCH .../status).
        //
        // The task write has already landed, so if the filing cannot follow it
        // back the task is put back too: a task that is open again with an
        // obligation still marked complete is the exact state to avoid.
        let reopened = false;
        try {
          ({ reopened } = await reopenItemForTask(supabase, existingTask, body.status, new Date()));
        } catch (reopenErr: any) {
          await supabase
            .from('tasks')
            .update({ status: existingTask.status, completedAt: existingTask.completedAt ?? null })
            .eq('id', taskId);
          throw new AppError(
            `Task was reopened but its compliance item could not be reopened: ${reopenErr?.message ?? reopenErr}. Task status rolled back.`,
            500,
          );
        }

        // Audit Log
        await supabase.from('audit_logs').insert({
          organizationId: authCtx.organizationId,
          actorId: authCtx.userId,
          actorEmail: authCtx.email,
          action: reopened ? 'task.reopen' : 'task.update',
          entityType: 'Task',
          entityId: taskId,
          before: { status: existingTask.status, assigneeId: existingTask.assigneeId },
          after: { status: updatedTask.status, assigneeId: updatedTask.assigneeId },
        });

        return jsonResponse(serialiseBigInt(updatedTask));
      }

      // DELETE /tasks/:id
      if (req.method === 'DELETE') {
        await assertCan(authCtx, existingTask.companyId, 'tasks.manage');
        const { error } = await supabase.from('tasks').delete().eq('id', taskId);
        if (error) throw new AppError(error.message, 400);
        return new Response(null, { status: 204 });
      }
    }

    // POST /tasks/:id/checklist/:entryId
    const checklistMatch = path.match(/^\/([a-f0-9-]+)\/checklist\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'POST' && checklistMatch) {
      const taskId = checklistMatch[1];
      const entryId = checklistMatch[2];
      const schema = z.object({ done: z.boolean() });
      const body = await parseJsonBody(req, schema);

      const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
      if (!task) throw new NotFoundError('Task not found');

      await assertCan(authCtx, task.companyId, 'tasks.manage');

      const checklist = (task.checklist as Array<{ id: string; label: string; done: boolean }>) || [];
      const updatedChecklist = checklist.map((item) => (item.id === entryId ? { ...item, done: body.done } : item));

      const { data: updated, error } = await supabase
        .from('tasks')
        .update({ checklist: updatedChecklist })
        .eq('id', taskId)
        .select()
        .single();

      if (error) throw new AppError(error.message, 400);
      return jsonResponse(serialiseBigInt(updated));
    }

    throw new BadRequestError(`No route matches ${req.method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
});
