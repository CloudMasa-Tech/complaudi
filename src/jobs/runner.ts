/**
 * Scheduled job execution.
 *
 * The scheduler lives outside the application — a platform cron, a Kubernetes
 * CronJob, or Supabase pg_cron calling the HTTP trigger. This module only cares
 * about running a job *exactly once* per slot, no matter how many replicas or
 * retries fire at it.
 *
 * Coordination is a unique row in `job_runs` rather than a Postgres advisory
 * lock, because session-level advisory locks are unsafe behind a transaction
 * pooler like Supavisor or PgBouncer: the session can be handed to another
 * client while you still think you hold the lock.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { JobRun } from '@prisma/client';
import { today } from '../lib/dates';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { refreshStatuses } from '../modules/compliance/compliance.service';
import { snapshotAllScores } from '../modules/dashboard/dashboard.service';
import { runReminderSweep } from '../modules/notifications/notifications.service';

/** A run still RUNNING after this long is presumed dead and may be taken over. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export type JobName = 'daily-compliance';

export type JobOutcome =
  | { ran: true; jobRun: JobRun; result: Record<string, unknown> }
  | { ran: false; reason: 'already-claimed' | 'already-succeeded'; jobRun: JobRun | null };

const instanceId = `${os.hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;

/**
 * Claims the slot, or reports who already has it.
 *
 * A previous run that failed, or one that has been RUNNING long enough to be
 * presumed dead, is taken over — otherwise a single crash would silently stop
 * the job until someone noticed.
 */
async function claim(jobName: JobName, scheduledFor: Date): Promise<JobRun | { taken: JobRun }> {
  const id = randomUUID();

  // ON CONFLICT DO NOTHING rather than catching a unique violation: losing the
  // race is the expected outcome for every replica but one, and it should not
  // surface as an error in the logs an operator is watching.
  const inserted = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO job_runs (id, "jobName", "scheduledFor", status, "startedAt", "claimedBy")
    VALUES (${id}, ${jobName}, ${scheduledFor}::date, 'RUNNING'::"JobStatus", now(), ${instanceId})
    ON CONFLICT ("jobName", "scheduledFor") DO NOTHING
    RETURNING id
  `;

  if (inserted.length > 0) return prisma.jobRun.findUniqueOrThrow({ where: { id } });

  const existing = await prisma.jobRun.findUniqueOrThrow({
    where: { jobName_scheduledFor: { jobName, scheduledFor } },
  });

  const isStale = existing.status === 'RUNNING' && Date.now() - existing.startedAt.getTime() > STALE_AFTER_MS;
  if (existing.status !== 'FAILED' && !isStale) return { taken: existing };

  // Re-claim, but only if nobody else got there first — the updateMany count
  // tells us whether we won the race.
  const { count } = await prisma.jobRun.updateMany({
    where: { id: existing.id, status: existing.status, startedAt: existing.startedAt },
    data: { status: 'RUNNING', claimedBy: instanceId, startedAt: new Date(), finishedAt: null, error: null },
  });
  if (count === 0) return { taken: existing };

  logger.warn(
    { jobName, previousStatus: existing.status, previousOwner: existing.claimedBy },
    'reclaiming a failed or stale job run',
  );
  return prisma.jobRun.findUniqueOrThrow({ where: { id: existing.id } });
}

/**
 * Refresh item statuses, send reminders, snapshot scores — in that order, so
 * reminders and scores both see an up-to-date view of what is overdue.
 */
async function dailyCompliance(): Promise<Record<string, unknown>> {
  const statuses = await refreshStatuses();
  const reminders = await runReminderSweep();
  const snapshots = await snapshotAllScores();
  return { statuses, reminders, snapshots };
}

const JOBS: Record<JobName, () => Promise<Record<string, unknown>>> = {
  'daily-compliance': dailyCompliance,
};

export async function runJob(
  jobName: JobName,
  opts: { scheduledFor?: Date; force?: boolean } = {},
): Promise<JobOutcome> {
  const scheduledFor = opts.scheduledFor ?? today();

  // `force` is for manual re-runs from an operator, and skips the claim.
  if (!opts.force) {
    const claimed = await claim(jobName, scheduledFor);
    if ('taken' in claimed) {
      const reason = claimed.taken.status === 'SUCCEEDED' ? 'already-succeeded' : 'already-claimed';
      logger.info({ jobName, scheduledFor, owner: claimed.taken.claimedBy, reason }, 'skipping job');
      return { ran: false, reason, jobRun: claimed.taken };
    }
    return execute(jobName, claimed);
  }

  const jobRun = await prisma.jobRun.upsert({
    where: { jobName_scheduledFor: { jobName, scheduledFor } },
    create: { jobName, scheduledFor, claimedBy: instanceId, status: 'RUNNING' },
    update: { status: 'RUNNING', claimedBy: instanceId, startedAt: new Date(), finishedAt: null, error: null },
  });
  return execute(jobName, jobRun);
}

async function execute(jobName: JobName, jobRun: JobRun): Promise<JobOutcome> {
  const startedAt = Date.now();
  logger.info({ jobName, jobRunId: jobRun.id, claimedBy: instanceId }, 'job started');

  try {
    const result = await JOBS[jobName]();
    const durationMs = Date.now() - startedAt;

    const finished = await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), durationMs, result: result as never },
    });

    logger.info({ jobName, jobRunId: jobRun.id, durationMs, ...result }, 'job succeeded');
    return { ran: true, jobRun: finished, result };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // Recording the failure is what lets the next run take the slot over.
    await prisma.jobRun
      .update({
        where: { id: jobRun.id },
        data: { status: 'FAILED', finishedAt: new Date(), durationMs, error: (err as Error).message.slice(0, 2000) },
      })
      .catch(() => undefined);

    logger.error({ err, jobName, jobRunId: jobRun.id, durationMs }, 'job failed');
    throw err;
  }
}

export async function recentJobRuns(limit = 20): Promise<JobRun[]> {
  return prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
}
