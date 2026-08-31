/**
 * Operator endpoints for an external scheduler.
 *
 * Use these when the platform can only schedule an HTTP call — Supabase
 * pg_cron with pg_net, GitHub Actions, Cloudflare Workers cron, an uptime
 * pinger. If the platform can run a container on a schedule, prefer
 * `node dist/jobs/daily.js`: it is not bound by an HTTP timeout.
 *
 * Authenticated by a shared secret, not a user JWT, so no human account has to
 * exist for the scheduler.
 */
import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { asyncHandler } from '../../lib/async';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { validateBody, validateParams } from '../../middleware/validate';
import { recentJobRuns, runJob, type JobName } from '../../jobs/runner';

const JOB_NAMES = ['daily-compliance'] as const;

/** Constant-time compare, so a wrong secret cannot be discovered by timing. */
function requireJobSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!env.JOB_TRIGGER_SECRET) {
    next(new ForbiddenError('The job trigger is disabled. Set JOB_TRIGGER_SECRET to enable it.'));
    return;
  }

  const presented = Buffer.from(req.header('x-job-secret') ?? '');
  const expected = Buffer.from(env.JOB_TRIGGER_SECRET);

  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    logger.warn({ ip: req.ip, path: req.path }, 'rejected job trigger with a bad secret');
    next(new UnauthorizedError('Invalid job secret'));
    return;
  }

  next();
}

export const internalRouter = Router();

internalRouter.use(
  rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }),
  requireJobSecret,
);

/**
 * Runs the job synchronously and reports what happened.
 *
 * If another replica already owns today's slot this returns 200 with
 * `ran: false` rather than an error — a duplicate trigger is expected, not a
 * fault, and a scheduler that retries on non-2xx should not be provoked.
 */
internalRouter.post(
  '/jobs/:name',
  validateParams(z.object({ name: z.enum(JOB_NAMES) })),
  validateBody(z.object({ force: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    const name = req.params.name as JobName;
    const outcome = await runJob(name, { force: req.body.force });

    res.json(
      outcome.ran
        ? { ran: true, jobRunId: outcome.jobRun.id, durationMs: outcome.jobRun.durationMs, result: outcome.result }
        : { ran: false, reason: outcome.reason, jobRunId: outcome.jobRun?.id ?? null },
    );
  }),
);

/** Job history — point an uptime monitor here to catch a scheduler that stopped firing. */
internalRouter.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const runs = await recentJobRuns(20);
    const last = runs[0] ?? null;

    res.json({
      lastRun: last,
      staleHours: last ? Math.round(((Date.now() - last.startedAt.getTime()) / 3_600_000) * 10) / 10 : null,
      runs,
    });
  }),
);
