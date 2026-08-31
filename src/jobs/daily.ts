#!/usr/bin/env node
/**
 * One-shot entrypoint for the daily job: `node dist/jobs/daily.js`.
 *
 * Run it as a scheduled container (Kubernetes CronJob, Render cron job, Fly
 * scheduled machine, ECS scheduled task). It exits non-zero on failure so the
 * platform can alert and retry — reruns are safe, the claim in `job_runs`
 * keeps them from doubling up.
 *
 *   --force          run even if this slot already succeeded (manual re-run)
 *   --date=<ISO>     run a specific slot, e.g. --date=2026-08-29
 */
import { logger } from '../lib/logger';
import { disconnectPrisma } from '../lib/prisma';
import { parseDate } from '../lib/dates';
import { runJob } from './runner';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dateArg = args.find((a) => a.startsWith('--date='))?.split('=')[1];

  const outcome = await runJob('daily-compliance', {
    force,
    ...(dateArg ? { scheduledFor: parseDate(dateArg) } : {}),
  });

  if (!outcome.ran) {
    logger.info({ reason: outcome.reason }, 'nothing to do — another instance owns this slot');
  }
}

main()
  .then(() => disconnectPrisma())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'daily job failed');
    await disconnectPrisma().catch(() => undefined);
    process.exit(1);
  });
