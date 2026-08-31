/**
 * In-process cron — a development convenience only.
 *
 * It is off by default (`ENABLE_CRON`), because every replica of the API would
 * fire it and every recipient would get duplicate reminder emails. In
 * production the schedule lives outside the application: a scheduled container
 * running `node dist/jobs/daily.js`, or a cron calling
 * `POST /internal/jobs/daily-compliance`. See DEPLOYMENT.md.
 *
 * Even here it goes through `runJob`, so the claim in `job_runs` protects
 * against a second local process.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { runJob } from './runner';

const tasks: ScheduledTask[] = [];

export async function runDailyJob(): Promise<void> {
  try {
    await runJob('daily-compliance');
  } catch (err) {
    logger.error({ err }, 'daily compliance job failed');
  }
}

export function startScheduler(): void {
  if (!env.ENABLE_CRON) {
    logger.info(
      { trigger: env.jobTriggerEnabled ? 'POST /internal/jobs/daily-compliance' : 'node dist/jobs/daily.js' },
      'in-process cron disabled — jobs are expected from an external scheduler',
    );
    return;
  }

  if (!cron.validate(env.REMINDER_CRON)) {
    logger.error({ expression: env.REMINDER_CRON }, 'invalid REMINDER_CRON expression — scheduler not started');
    return;
  }

  if (env.isProd) {
    logger.warn(
      'ENABLE_CRON is on in production. This is safe only on a single instance; ' +
        'prefer an external scheduler so the schedule survives restarts and scaling.',
    );
  }

  const task = cron.schedule(env.REMINDER_CRON, () => void runDailyJob(), { timezone: env.TIMEZONE });
  tasks.push(task);
  logger.info({ expression: env.REMINDER_CRON, timezone: env.TIMEZONE }, 'in-process scheduler started');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
