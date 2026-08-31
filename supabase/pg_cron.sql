-- ============================================================================
-- Optional: schedule the daily compliance sweep inside Postgres (DEPLOYMENT.md,
-- "Option C — Supabase pg_cron"). Skip this file entirely if you drive the job
-- from your platform's scheduler or GitHub Actions instead — running two
-- schedulers is harmless (the job takes an advisory lock and a duplicate exits
-- 409) but it doubles the noise.
--
-- Idempotent: re-running replaces the secret and the cron entry in place.
--
-- Requires the API to expose POST /internal/jobs/:name, which happens only when
-- JOB_TRIGGER_SECRET is set in the app's environment. The value passed here
-- must be that same secret.
--
--   psql "$DIRECT_URL" \
--     -v app_base_url='https://compliance.example.com' \
--     -v job_secret='<JOB_TRIGGER_SECRET>' \
--     -v cron_schedule='30 2 * * *' \
--     -f supabase/pg_cron.sql
--
-- Run it against DIRECT_URL (session, port 5432) as the postgres role. Note the
-- secret reaches your shell history — prefer the Supabase SQL editor, or a
-- leading space, if that matters to you.
--
-- pg_cron schedules in UTC. 02:30 UTC = 08:00 IST, which lines up with the
-- REMINDER_CRON default of 0 8 * * * in Asia/Kolkata.
-- ============================================================================

\set ON_ERROR_STOP on

-- A forgotten -v must fail the run, not schedule a job that posts nowhere.
-- The guard raises rather than using \quit, which ignores its argument and exits
-- 0 — a deploy step would read that as success.
\if :{?cron_schedule}
\else
  \set cron_schedule '30 2 * * *'
\endif

\if :{?app_base_url}
\else
  \echo 'app_base_url is required:  -v app_base_url=https://compliance.example.com'
  do $g$ begin raise exception 'app_base_url is required'; end $g$;
\endif

\if :{?job_secret}
\else
  \echo 'job_secret is required:  -v job_secret=<JOB_TRIGGER_SECRET>'
  do $g$ begin raise exception 'job_secret is required'; end $g$;
\endif

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── the secret ───────────────────────────────────────────────────────────────
--
-- Kept in Vault rather than inline in the cron command: cron.job is readable by
-- anyone who can query it, and the job trigger secret is a bearer credential —
-- whoever holds it can run the sweep at will.
--
-- Carried through a session GUC because psql does not substitute :vars inside
-- dollar-quoted blocks.
select set_config('compliance.job_secret', :'job_secret', false);

do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'job_trigger_secret';
  if v_id is null then
    perform vault.create_secret(
      current_setting('compliance.job_secret'),
      'job_trigger_secret',
      'JOB_TRIGGER_SECRET — authenticates POST /internal/jobs/:name'
    );
  else
    perform vault.update_secret(
      v_id,
      current_setting('compliance.job_secret'),
      'job_trigger_secret',
      'JOB_TRIGGER_SECRET — authenticates POST /internal/jobs/:name'
    );
  end if;
end $$;

select set_config('compliance.job_secret', '', false);

-- ── the schedule ─────────────────────────────────────────────────────────────
--
-- Dropped and recreated rather than edited, so a changed URL or cadence cannot
-- leave a stale second entry behind.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-compliance') then
    perform cron.unschedule('daily-compliance');
  end if;
end $$;

-- pg_net is fire-and-forget: it records the response but the cron entry
-- succeeds even when the API returns 500. The health of the sweep itself is in
-- the JobRun table (GET /api/v1/admin/jobs), not here.
select cron.schedule(
  'daily-compliance',
  :'cron_schedule',
  format(
    $cmd$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
                   'content-type', 'application/json',
                   'x-job-secret', (select decrypted_secret
                                    from vault.decrypted_secrets
                                    where name = 'job_trigger_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cmd$,
    rtrim(:'app_base_url', '/') || '/internal/jobs/daily-compliance'
  )
);

-- ── verify ───────────────────────────────────────────────────────────────────
select jobname, schedule, active from cron.job where jobname = 'daily-compliance';

\echo ''
\echo 'Scheduled. After the first firing, check both sides:'
\echo '  select d.status, d.return_message, d.start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = ''daily-compliance'' order by d.start_time desc limit 5;'
\echo '  select status_code, error_msg, created from net._http_response order by created desc limit 5;'
\echo 'To remove:  select cron.unschedule(''daily-compliance'');'
