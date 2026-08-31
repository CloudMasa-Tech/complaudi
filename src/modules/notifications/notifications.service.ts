import type { ComplianceItem, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { addDays, diffDays, today } from '../../lib/dates';
import { logger } from '../../lib/logger';
import { sendMail } from '../../lib/mailer';
import { prisma } from '../../lib/prisma';
import { digestHtml, digestSubject, digestText, type ReminderLine } from './templates';

/** Days overdue at which we nudge again, so a missed filing is not forgotten. */
const OVERDUE_NUDGE_DAYS = [1, 3, 7, 14, 30];

export interface SweepResult {
  scannedItems: number;
  notificationsCreated: number;
  emailsSent: number;
  emailsFailed: number;
  recipients: number;
}

type ItemWithContext = ComplianceItem & {
  company: { id: string; legalName: string; organizationId: string; createdAt: Date };
  task: { assigneeId: string | null } | null;
};

function reminderKind(daysOut: number): string | null {
  if (daysOut === 0) return 'DUE_TODAY';
  if (daysOut > 0) return env.reminderOffsetDays.includes(daysOut) ? `DUE_IN_${daysOut}` : null;
  const overdueBy = Math.abs(daysOut);
  return OVERDUE_NUDGE_DAYS.includes(overdueBy) ? `OVERDUE_${overdueBy}` : null;
}

/**
 * Who hears about an obligation: the person it is assigned to, or — when nobody
 * has picked it up — everyone who can act on it.
 */
async function resolveRecipients(organizationIds: string[]) {
  const users = await prisma.user.findMany({
    where: { organizationId: { in: organizationIds }, isActive: true },
    select: { id: true, name: true, email: true, role: true, organizationId: true },
  });

  // Who hears about an unowned obligation: the people who actually hold that
  // company, and the super admins who see everything. A scoped admin must not
  // be chased about a client they cannot open.
  // Super admins are added separately below, and may still hold dormant grants
  // from before they were promoted — counting those here would chase them twice
  // for the same obligation.
  const memberships = await prisma.companyMembership.findMany({
    where: {
      user: { organizationId: { in: organizationIds }, isActive: true, role: { not: 'SUPER_ADMIN' } },
      role: { not: 'VIEWER' },
    },
    select: { userId: true, companyId: true },
  });

  const fallbackByCompany = new Map<string, typeof users>();
  const byId = new Map(users.map((u) => [u.id, u]));
  for (const m of memberships) {
    const user = byId.get(m.userId);
    if (!user) continue;
    const list = fallbackByCompany.get(m.companyId) ?? [];
    list.push(user);
    fallbackByCompany.set(m.companyId, list);
  }

  const superAdminsByOrg = new Map<string, typeof users>();
  for (const user of users) {
    if (user.role !== 'SUPER_ADMIN') continue;
    const list = superAdminsByOrg.get(user.organizationId) ?? [];
    list.push(user);
    superAdminsByOrg.set(user.organizationId, list);
  }

  return { byId, fallbackByCompany, superAdminsByOrg };
}

/**
 * Finds everything that needs a reminder today, records one notification per
 * (item, user, kind), then sends each person a single digest rather than a
 * stream of separate emails.
 */
export async function runReminderSweep(opts: { asOf?: Date; organizationId?: string } = {}): Promise<SweepResult> {
  const asOf = opts.asOf ?? today();
  const horizon = addDays(asOf, Math.max(...env.reminderOffsetDays, 0));
  const oldest = addDays(asOf, -Math.max(...OVERDUE_NUDGE_DAYS));

  const items = (await prisma.complianceItem.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'WAIVED'] },
      dueDate: { gte: oldest, lte: horizon },
      company: {
        isActive: true,
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      },
    },
    include: {
      company: { select: { id: true, legalName: true, organizationId: true, createdAt: true } },
      task: { select: { assigneeId: true } },
    },
  })) as ItemWithContext[];

  if (items.length === 0) {
    return { scannedItems: 0, notificationsCreated: 0, emailsSent: 0, emailsFailed: 0, recipients: 0 };
  }

  const { byId, fallbackByCompany, superAdminsByOrg } = await resolveRecipients([
    ...new Set(items.map((i) => i.company.organizationId)),
  ]);

  const pending: Array<{ userId: string; item: ItemWithContext; kind: string; daysOut: number }> = [];
  for (const item of items) {
    // The calendar is back-filled on onboarding, so a new account inherits a
    // year of already-overdue entries. Emailing about those every few days is
    // noise about filings that may well have been made long before signup.
    if (item.dueDate < item.company.createdAt) continue;

    const daysOut = diffDays(asOf, item.dueDate);
    const kind = reminderKind(daysOut);
    if (!kind) continue;

    const assignee = item.task?.assigneeId ? byId.get(item.task.assigneeId) : undefined;
    const unowned = [
      ...(fallbackByCompany.get(item.company.id) ?? []),
      ...(superAdminsByOrg.get(item.company.organizationId) ?? []),
    ];
    const recipients = assignee ? [assignee] : [...new Map(unowned.map((u) => [u.id, u])).values()];
    for (const user of recipients) pending.push({ userId: user.id, item, kind, daysOut });
  }

  // The (complianceItemId, userId, kind) unique index makes this idempotent:
  // running the sweep twice in a day sends nothing the second time.
  const created = await prisma.notification.createManyAndReturn({
    data: pending.map((p) => ({
      userId: p.userId,
      complianceItemId: p.item.id,
      channel: 'EMAIL' as const,
      kind: p.kind,
      subject: `${p.item.title} — ${p.item.periodLabel}`,
      body: `Due ${p.item.dueDate.toISOString().slice(0, 10)}`,
      status: 'PENDING' as const,
    })),
    skipDuplicates: true,
  });

  if (created.length === 0) {
    return { scannedItems: items.length, notificationsCreated: 0, emailsSent: 0, emailsFailed: 0, recipients: 0 };
  }

  // Group the freshly created notifications into one digest per person.
  const contextByItemId = new Map(items.map((i) => [i.id, i]));
  const daysOutByKey = new Map(pending.map((p) => [`${p.userId}::${p.item.id}::${p.kind}`, p.daysOut]));
  const digests = new Map<string, { notificationIds: string[]; lines: ReminderLine[] }>();

  for (const notification of created) {
    if (!notification.userId || !notification.complianceItemId) continue;
    const item = contextByItemId.get(notification.complianceItemId);
    if (!item) continue;

    const bucket = digests.get(notification.userId) ?? { notificationIds: [], lines: [] };
    bucket.notificationIds.push(notification.id);
    bucket.lines.push({
      companyName: item.company.legalName,
      title: item.title,
      form: item.form,
      periodLabel: item.periodLabel,
      dueDate: item.dueDate,
      severity: item.severity,
      daysOut: daysOutByKey.get(`${notification.userId}::${item.id}::${notification.kind}`) ?? diffDays(asOf, item.dueDate),
      penaltyNote: item.penaltyNote,
    });
    digests.set(notification.userId, bucket);
  }

  let emailsSent = 0;
  let emailsFailed = 0;

  for (const [userId, digest] of digests) {
    const user = byId.get(userId);
    if (!user) continue;

    try {
      await sendMail({
        to: user.email,
        subject: digestSubject(digest.lines),
        text: digestText(user.name, digest.lines, env.APP_BASE_URL),
        html: digestHtml(user.name, digest.lines, env.APP_BASE_URL),
      });
      await prisma.notification.updateMany({
        where: { id: { in: digest.notificationIds } },
        data: { status: 'SENT', sentAt: new Date() },
      });
      emailsSent += 1;
    } catch (err) {
      logger.error({ err, userId }, 'failed to send reminder digest');
      await prisma.notification.updateMany({
        where: { id: { in: digest.notificationIds } },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) },
      });
      emailsFailed += 1;
    }
  }

  const result: SweepResult = {
    scannedItems: items.length,
    notificationsCreated: created.length,
    emailsSent,
    emailsFailed,
    recipients: digests.size,
  };
  logger.info(result, 'reminder sweep complete');
  return result;
}

// ---------------------------------------------------------------- in-app feed

export async function listNotifications(userId: string, q: { unreadOnly: boolean; page: number; pageSize: number }) {
  const where: Prisma.NotificationWhereInput = { userId, ...(q.unreadOnly ? { readAt: null } : {}) };

  const [total, unread, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        complianceItem: {
          select: { id: true, title: true, dueDate: true, status: true, severity: true, authority: true },
        },
      },
    }),
  ]);

  return { total, unread, page: q.page, pageSize: q.pageSize, rows };
}

export async function markRead(userId: string, notificationIds: string[]) {
  const { count } = await prisma.notification.updateMany({
    where: { id: { in: notificationIds }, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: count };
}

export async function markAllRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
