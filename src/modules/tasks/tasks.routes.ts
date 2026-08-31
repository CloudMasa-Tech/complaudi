import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { boolish } from '../../lib/boolish';
import { csvEnum, dateQuery, paginationSchema } from '../../lib/pagination';
import { auth, requireAuth } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as service from './tasks.service';

// Company-scoped routes carry no capability guard here: the base role is not
// the authority once a grant exists, and the company is not known until the
// service resolves it. Authorisation happens there, via assertCan().
export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });

tasksRouter.get(
  '/',
  validateQuery(
    paginationSchema.extend({
      companyId: z.string().uuid().optional(),
      status: csvEnum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']),
      assigneeId: z.string().uuid().optional(),
      unassignedOnly: boolish().optional(),
      overdueOnly: boolish().optional(),
      from: dateQuery,
      to: dateQuery,
      search: z.string().max(120).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await service.listTasks(auth(req), req.query as never));
  }),
);

/** Everything currently on my plate. */
tasksRouter.get(
  '/mine',
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const q = req.query as unknown as { page: number; pageSize: number };
    res.json(
      await service.listTasks(me, {
        assigneeId: me.userId,
        status: ['TODO', 'IN_PROGRESS', 'BLOCKED'],
        page: q.page,
        pageSize: q.pageSize,
      }),
    );
  }),
);

tasksRouter.get(
  '/workload',
  validateQuery(z.object({ companyId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const { companyId } = req.query as { companyId?: string };
    res.json(await service.workloadByAssignee(auth(req), companyId));
  }),
);

/** People who may be given work on a company — not everyone in the organisation. */
tasksRouter.get(
  '/assignable',
  validateQuery(z.object({ companyId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const { companyId } = req.query as { companyId?: string };
    res.json(await service.assignableUsers(auth(req), companyId));
  }),
);

tasksRouter.get(
  '/:id',
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    res.json(await service.getTaskOrThrow(auth(req), req.params.id!));
  }),
);

tasksRouter.patch(
  '/:id',
  validateParams(idParam),
  validateBody(
    z.object({
      status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
      assigneeId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
      description: z.string().max(5000).nullable().optional(),
      checklist: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() })).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const before = await service.getTaskOrThrow(me, req.params.id!);
    const task = await service.updateTask(me, req.params.id!, {
      ...req.body,
      actorId: auth(req).userId,
    });
    await recordAudit({
      organizationId: me.organizationId,
      action: 'task.update',
      entityType: 'Task',
      entityId: task.id,
      before: { status: before.status, assigneeId: before.assigneeId },
      after: { status: task.status, assigneeId: task.assigneeId },
      req,
    });
    res.json(task);
  }),
);

tasksRouter.post(
  '/:id/checklist/:entryId',
  validateParams(z.object({ id: z.string().uuid(), entryId: z.string().max(40) })),
  validateBody(z.object({ done: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(await service.toggleChecklistItem(auth(req), req.params.id!, req.params.entryId!, req.body.done));
  }),
);

tasksRouter.post(
  '/bulk-assign',
  validateBody(z.object({ taskIds: z.array(z.string().uuid()).min(1).max(500), assigneeId: z.string().uuid().nullable() })),
  asyncHandler(async (req, res) => {
    const me = auth(req);
    const result = await service.bulkAssign(me, req.body.taskIds, req.body.assigneeId);
    await recordAudit({ organizationId: me.organizationId, action: 'task.bulk_assign', entityType: 'Task', after: result, req });
    res.json(result);
  }),
);
