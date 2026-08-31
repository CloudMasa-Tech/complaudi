import type { Prisma, TaskStatus } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { today } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { assertCan, companyScope, type Actor } from '../../lib/access';

export interface TaskQuery {
  companyId?: string;
  status?: TaskStatus[];
  assigneeId?: string;
  /** "unassigned" is a distinct filter from "no assignee filter". */
  unassignedOnly?: boolean;
  overdueOnly?: boolean;
  from?: Date;
  to?: Date;
  search?: string;
  page: number;
  pageSize: number;
}

const taskInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  complianceItem: {
    select: {
      id: true,
      ruleCode: true,
      authority: true,
      category: true,
      form: true,
      severity: true,
      status: true,
      periodLabel: true,
      legalReference: true,
      penaltyNote: true,
      evidenceRequired: true,
      evidenceLevel: true,
    },
  },
  _count: { select: { documents: true } },
} satisfies Prisma.TaskInclude;

export async function listTasks(actor: Actor, q: TaskQuery) {
  // Built as an AND list so that overlapping filters — an explicit status plus
  // `overdueOnly`, or two date bounds — compose instead of overwriting.
  const and: Prisma.TaskWhereInput[] = [{ complianceItem: { company: companyScope(actor, q.companyId) } }];

  if (q.companyId) and.push({ companyId: q.companyId });
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.unassignedOnly) and.push({ assigneeId: null });
  else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
  if (q.overdueOnly) and.push({ dueDate: { lt: today() }, status: { notIn: ['DONE', 'CANCELLED'] } });
  if (q.from) and.push({ dueDate: { gte: q.from } });
  if (q.to) and.push({ dueDate: { lte: q.to } });
  if (q.search) and.push({ title: { contains: q.search, mode: 'insensitive' } });

  const where: Prisma.TaskWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: taskInclude,
    }),
  ]);

  return { total, page: q.page, pageSize: q.pageSize, rows };
}

export async function getTaskOrThrow(actor: Actor, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, complianceItem: { company: companyScope(actor) } },
    include: { ...taskInclude, documents: { orderBy: { createdAt: 'desc' } } },
  });
  if (!task) throw new NotFoundError('Task');
  return task;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  assigneeId?: string | null;
  notes?: string | null;
  description?: string | null;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  /**
   * Present only so the reopen path can attribute the change. Declarations and
   * signatories belong to completing the obligation, not to moving a task.
   */
  actorId?: string | null;
}

/**
 * Task state and compliance-item state are kept in step: marking the task DONE
 * completes the underlying obligation, and reopening it puts the obligation
 * back into the calendar with a freshly derived status.
 */
export async function updateTask(actor: Actor, taskId: string, input: UpdateTaskInput) {
  const existing = await getTaskOrThrow(actor, taskId);
  await assertCan(actor, existing.companyId, 'work.write');

  if (input.assigneeId) await assertAssignable(actor, existing.companyId, input.assigneeId);

  const becomingDone = input.status === 'DONE' && existing.status !== 'DONE';
  const leavingDone = input.status !== undefined && input.status !== 'DONE' && existing.status === 'DONE';
  const completedAt = becomingDone ? new Date() : leavingDone ? null : undefined;

  // Marking the task DONE says the *work* is finished. It deliberately does not
  // file the obligation: that is a separate, explicit act which has to clear the
  // evidence gate (see assertCompletionAllowed). Conflating the two let someone
  // close a statutory filing by flipping a dropdown on the task board.

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.update({
      where: { id: taskId },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.checklist !== undefined ? { checklist: input.checklist as unknown as Prisma.InputJsonValue } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
      include: taskInclude,
    });

    // Reopening the work reopens the filing: an obligation must never read
    // COMPLETED while the task behind it has been pulled back open.
    if (leavingDone) {
      const item = await tx.complianceItem.findUniqueOrThrow({
        where: { id: existing.complianceItemId },
        select: { dueDate: true, status: true },
      });
      const now = today();
      const days = Math.round((item.dueDate.getTime() - now.getTime()) / 86_400_000);
      if (item.status === 'COMPLETED') await tx.complianceItem.update({
        where: { id: existing.complianceItemId },
        data: {
          status: days < 0 ? 'OVERDUE' : days <= 7 ? 'DUE' : 'UPCOMING',
          completedAt: null,
          attestationText: null,
          attestedById: null,
          attestedAt: null,
          signatoryName: null,
        },
      });
    }

    return task;
  });
}

export async function bulkAssign(actor: Actor, taskIds: string[], assigneeId: string | null) {
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, complianceItem: { company: companyScope(actor) } },
    select: { id: true, companyId: true },
  });

  // Each company is checked separately: a bulk assignment can span clients, and
  // both the right to assign and the right to be assigned are held per client.
  for (const companyId of new Set(tasks.map((t) => t.companyId))) {
    await assertCan(actor, companyId, 'work.write');
    if (assigneeId) await assertAssignable(actor, companyId, assigneeId);
  }

  const { count } = await prisma.task.updateMany({
    where: { id: { in: tasks.map((t) => t.id) } },
    data: { assigneeId },
  });
  return { updated: count };
}

/** Toggles one checklist entry without the caller having to send the whole array. */
export async function toggleChecklistItem(actor: Actor, taskId: string, entryId: string, done: boolean) {
  const task = await getTaskOrThrow(actor, taskId);
  await assertCan(actor, task.companyId, 'work.write');
  const checklist = (task.checklist as Array<{ id: string; label: string; done: boolean }>) ?? [];
  const entry = checklist.find((c) => c.id === entryId);
  if (!entry) throw new NotFoundError('Checklist entry');

  const next = checklist.map((c) => (c.id === entryId ? { ...c, done } : c));
  return prisma.task.update({
    where: { id: taskId },
    data: { checklist: next as unknown as Prisma.InputJsonValue },
    include: taskInclude,
  });
}

/** Open work grouped by assignee — the "who is behind" view. */
/**
 * Who may be given work on a company.
 *
 * Not "everyone in the organisation": assigning a filing to someone who cannot
 * open the company is a task that will never be done, and it leaks the names of
 * colleagues who have nothing to do with that client.
 *
 * Excluded deliberately: VIEWERs, who are read-only, and the super admin, who
 * administers the platform rather than working the filings.
 */
export async function assignableUsers(actor: Actor, companyId?: string) {
  if (companyId) {
    const reachable = await prisma.company.findFirst({ where: companyScope(actor, companyId), select: { id: true } });
    if (!reachable) throw new NotFoundError('Company');
  }

  return prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      isActive: true,
      role: { notIn: ['SUPER_ADMIN', 'VIEWER'] },
      // Everyone is scoped now, so a grant is the only way in.
      ...(companyId
        ? { memberships: { some: { companyId, role: { not: 'VIEWER' } } } }
        : { memberships: { some: { company: companyScope(actor), role: { not: 'VIEWER' } } } }),
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

/** Refuses an assignee who could not open the company the task belongs to. */
async function assertAssignable(actor: Actor, companyId: string, assigneeId: string): Promise<void> {
  const allowed = await assignableUsers(actor, companyId);
  if (!allowed.some((u) => u.id === assigneeId)) {
    throw new BadRequestError(
      'That person cannot be given work on this company. They need access to it first, and viewers and super admins are never assigned filings.',
    );
  }
}

export async function workloadByAssignee(actor: Actor, companyId?: string) {
  const rows = await prisma.task.groupBy({
    by: ['assigneeId', 'status'],
    where: {
      complianceItem: { company: companyScope(actor, companyId) },
      ...(companyId ? { companyId } : {}),
      status: { notIn: ['DONE', 'CANCELLED'] },
    },
    _count: { _all: true },
  });

  const userIds = [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: actor.organizationId },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const grouped = new Map<string, { assignee: { id: string; name: string; email: string } | null; counts: Record<string, number>; total: number }>();
  for (const row of rows) {
    const key = row.assigneeId ?? 'unassigned';
    if (!grouped.has(key)) {
      grouped.set(key, { assignee: row.assigneeId ? byId.get(row.assigneeId) ?? null : null, counts: {}, total: 0 });
    }
    const bucket = grouped.get(key)!;
    bucket.counts[row.status] = row._count._all;
    bucket.total += row._count._all;
  }

  return [...grouped.values()].sort((a, b) => b.total - a.total);
}
