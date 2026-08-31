import type { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface AuditInput {
  organizationId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

function jsonSafe(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Writes an audit entry. Deliberately never throws: losing an audit row is bad,
 * but failing the user's action because the audit write failed is worse — and
 * the failure is logged for follow-up.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? input.req?.auth?.userId ?? null,
        actorEmail: input.actorEmail ?? input.req?.auth?.email ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: jsonSafe(input.before),
        after: jsonSafe(input.after),
        ip: input.req?.ip ?? null,
        userAgent: input.req?.header('user-agent') ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action, entityId: input.entityId }, 'failed to write audit log');
  }
}

export interface AuditQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export async function listAuditLogs(q: AuditQuery) {
  const where = {
    organizationId: q.organizationId,
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.action ? { action: { contains: q.action, mode: 'insensitive' as const } } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return { total, page: q.page, pageSize: q.pageSize, rows };
}
