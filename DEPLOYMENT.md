# Production deployment — Supabase Postgres

A runbook for taking this from a laptop to a hosted environment, with **no
in-process schedulers**.

---

## Why the scheduler moves out

The `node-cron` schedule in `src/jobs/scheduler.ts` is a development
convenience and is **off by default** (`ENABLE_CRON=false`). Leaving it on in
production breaks the moment you run more than one instance: every replica
fires the sweep, and every recipient gets duplicate reminder emails. It also
dies with the process, so a restart at 07:59 silently skips that day.

Production drives the same code from outside:

```
        ┌────────────────────┐
        │ external scheduler │   K8s CronJob · Render Cron · Fly machine
        │ (one of three)     │   GitHub Actions · Supabase pg_cron
        └─────────┬──────────┘
                  │ runs a container            or  POSTs with a shared secret
                  ▼                                          ▼
        node dist/jobs/daily.js            POST /internal/jobs/daily-compliance
                  └──────────────┬───────────────────────────┘
                                 ▼
                         runJob('daily-compliance')
                                 │
                    claim a row in `job_runs`  ── lost the race? exit 0, do nothing
                                 │ won
                                 ▼
              refresh statuses → send reminders → snapshot scores
```

Whoever inserts `(jobName, scheduledFor)` into `job_runs` first owns the slot;
everyone else backs off. That is what makes it safe to run **any number of
replicas, and to mix the three trigger styles**, without double-sending.

> Coordination is a unique row rather than a Postgres advisory lock on purpose:
> session-level advisory locks are unsafe behind a transaction pooler such as
> Supavisor, because the session can be handed to another client while you still
> believe you hold the lock.

A run that fails, or that has been `RUNNING` for over 30 minutes, is presumed
dead and taken over by the next trigger — so one crash does not stop the job
until somebody notices.

---

## Step 1 — Supabase

**1.1 Create the project.** Pick the region closest to your app servers;
every query pays that round trip.

**1.2 Collect two connection strings.** *Project Settings → Database →
Connection string*. You need both, and they are not interchangeable:

| Variable | Which string | Port | Used for |
|---|---|---|---|
| `DATABASE_URL` | **Transaction pooler** | 6543 | The application at runtime |
| `DIRECT_URL` | **Session pooler** | 5432 | `prisma migrate deploy` |

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Three details that cause real outages if missed:

- **`?pgbouncer=true` is mandatory** on the pooled URL. Without it Prisma uses
  prepared statements, which a transaction pooler cannot honour, and you get
  intermittent `prepared statement "s0" already exists` errors under load.
- **`connection_limit`** is *per instance*. Multiply by your replica count and
  stay under the project's pool size. Start at 10 for a long-running container;
  use 1 for serverless, where every invocation opens its own pool.
- **Migrations must not use the pooled URL.** DDL and Prisma's migration
  advisory lock both need a real session. `directUrl` in `schema.prisma`
  already routes migrations to `DIRECT_URL`.

> Supabase's *Direct connection* string also works for `DIRECT_URL`, but it is
> IPv6-only. GitHub Actions runners are IPv4, so use the **session pooler**
> unless you have IPv6 egress.

**1.3 Create the storage bucket.** *Storage → New bucket*:

- Name: `compliance-evidence` (must match `SUPABASE_STORAGE_BUCKET`)
- **Private** — leave "Public bucket" off. The API issues 5-minute signed URLs.
- Optional file size limit: 25 MB, matching the API's own cap.

**1.4 Grab the service role key.** *Project Settings → API → `service_role`*.
This key bypasses row-level security and must never reach the browser. It is
used only by the API server, which enforces tenant isolation in its query layer
(every read is scoped by `organizationId`).

> This app does **not** use Supabase Auth or RLS. It has its own JWT auth and
> connects as a privileged role. If you later expose Postgres directly to any
> untrusted client, you must add RLS policies first — the current isolation
> guarantee lives entirely in the application.

---

## Step 2 — Generate secrets

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 48   # JOB_TRIGGER_SECRET  (only if using the HTTP trigger)
```

Store them in your platform's secret manager. Rotating `JWT_ACCESS_SECRET`
invalidates every live access token (users re-auth silently via refresh);
rotating `JWT_REFRESH_SECRET` signs everyone out.

---

## Step 3 — Environment

```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info
APP_BASE_URL=https://compliance.example.com
CORS_ORIGINS=https://compliance.example.com     # ignored when SERVE_WEB=true

DATABASE_URL=...            # pooled, port 6543, ?pgbouncer=true
DIRECT_URL=...              # session pooler, port 5432

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=compliance-evidence

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
BCRYPT_ROUNDS=12

SMTP_HOST=smtp.provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Compliance Toolkit <no-reply@example.com>"

SERVE_WEB=true              # serve the dashboard from this origin
ENABLE_CRON=false           # ← keep this false
JOB_TRIGGER_SECRET=...      # only if using the HTTP trigger
TIMEZONE=Asia/Kolkata
REMINDER_OFFSET_DAYS=30,15,7,3,1,0
```

**Verify `ENABLE_CRON` after deploy.** Boot logs must contain:

```
cron disabled — jobs are expected from an external scheduler
```

If they say `in-process scheduler started`, the flag did not take and you will
send duplicate emails once you scale past one instance.

> Booleans are parsed by `src/lib/boolish.ts`, not `z.coerce.boolean()`, which
> treats the *string* `"false"` as `true` — so `ENABLE_CRON=false` really is off.

---

## Step 4 — Migrations

Migrations run as a **separate step in the deploy pipeline**, before the new
image starts serving. Never on application boot: replicas would race, and a
failed migration would crash-loop the service instead of failing the deploy
where you can see it.

```bash
npm run migrate:prod:check    # what is pending, changes nothing
npm run migrate:prod          # apply, then provision the storage bucket
npm run migrate:prod -- --yes # no prompt, for a pipeline step
```

`scripts/migrate-production.sh` wraps the two Prisma commands below and adds the
checks that are easy to skip by hand: it refuses a `DIRECT_URL` pointing at the
transaction pooler, refuses to run unattended without `--yes`, stops on a failed
migration rather than deploying over it, and finishes by running
`supabase/setup.sql` for the evidence bucket. Use the raw commands if you prefer:

```bash
npx prisma migrate status     # what is pending
npx prisma migrate deploy     # apply — uses DIRECT_URL, additive only
```

`migrate deploy` never resets, never prompts, and never generates SQL. It only
applies committed migrations from `prisma/migrations/`.

**Adopting an existing database.** If the schema is already there — say you
restored a dump — baseline it so Prisma does not try to recreate the tables:

```bash
npx prisma migrate resolve --applied 20260829142324_init
npx prisma migrate resolve --applied 20260829150555_add_job_runs
```

**Expand/contract for anything destructive.** `migrate deploy` will not warn
you about data loss. A rename must ship as: add the new column → backfill →
deploy code writing both → deploy code reading the new one → drop the old
column in a later release. Dropping in one step breaks every replica still
running the previous image during the rollout.

**Storage bucket.** Not a Prisma migration — it lives in the `storage` schema,
outside the migration history. `npm run supabase:bootstrap` applies
`supabase/setup.sql`, which upserts the private `compliance-evidence` bucket and
warns if anything has opened it up. `npm run migrate:prod` calls it for you.

**Seed data.** `npm run seed` creates the *demo* organization. Do not run it in
production. Create the first real account through `POST /api/v1/auth/register`,
which makes the organization and its OWNER in one transaction.

---

## Step 5 — Build and deploy

The `Dockerfile` is multi-stage and produces one ~394 MB image containing the
API, the built dashboard, the Prisma client and the Prisma CLI. It runs as the
non-root `node` user, has a `HEALTHCHECK`, and uses `tini` so `SIGTERM` reaches
Node — which drains in-flight requests before closing the database connection.

```bash
docker build -t ghcr.io/you/compliance-toolkit:$(git rev-parse --short HEAD) .
docker push ghcr.io/you/compliance-toolkit:...
```

Health endpoints for your platform:

| Path | Use |
|---|---|
| `/health` | Liveness. No database dependency, so a database blip does not trigger restarts. |
| `/ready` | Readiness. Checks Postgres and reports the active storage and mail drivers. |

`.github/workflows/deploy.yml` runs build → migrate → deploy → smoke test, with
a `concurrency` group so two deploys never race on the database. Replace the
placeholder deploy step with your platform's.

**Hosting the dashboard separately** (Vercel, Cloudflare Pages, S3+CloudFront)
is also supported: set `SERVE_WEB=false`, add the front end's origin to
`CORS_ORIGINS`, and point the SPA's `/api` proxy at the API host.

---

## Step 6 — Schedule the daily job

Pick **one**. All three call the same code path and are protected by the same
claim, so a belt-and-braces overlap is harmless.

### Option A — a scheduled container *(recommended)*

Nothing is exposed to the network, and the job is not bound by an HTTP timeout.
Run `node dist/jobs/daily.js` on a schedule, with the same environment as the
API. It exits `0` on success or when another instance owns the slot, and `1`
on failure, so your platform's alerting works normally.

<details>
<summary><b>Kubernetes</b></summary>

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: compliance-daily
spec:
  schedule: "30 2 * * *"          # 02:30 UTC = 08:00 IST
  timeZone: "Asia/Kolkata"        # k8s >= 1.27; then use "0 8 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  startingDeadlineSeconds: 3600   # still run if the cluster was busy
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 1800
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: daily
              image: ghcr.io/you/compliance-toolkit:<sha>
              command: ["node", "dist/jobs/daily.js"]
              envFrom:
                - secretRef: { name: compliance-env }
              resources:
                requests: { cpu: 100m, memory: 256Mi }
                limits:   { memory: 512Mi }
```
</details>

<details>
<summary><b>Render · Railway · Fly.io · AWS ECS</b></summary>

**Render** — *New → Cron Job*, same image and env group:
`0 8 * * *` (Render cron is UTC; use `30 2 * * *` for 08:00 IST),
command `node dist/jobs/daily.js`.

**Railway** — add a service from the same image, set its **Cron Schedule** to
`30 2 * * *` and start command `node dist/jobs/daily.js`.

**Fly.io** — `fly machine run <image> --schedule daily --command "node dist/jobs/daily.js"`,
or a `[processes]` entry driven by `fly machine update --schedule`.

**AWS ECS** — an EventBridge Scheduler rule with a `RunTask` target, container
override `["node","dist/jobs/daily.js"]`, on the same task definition.
</details>

Run it by hand, or backfill a missed day:

```bash
node dist/jobs/daily.js                      # today's slot
node dist/jobs/daily.js --date=2026-08-28    # a specific day
node dist/jobs/daily.js --force              # re-run a slot that already succeeded
```

### Option B — HTTP trigger

For platforms that can only schedule an HTTP call. Set `JOB_TRIGGER_SECRET`;
leaving it unset disables the endpoint entirely.

```bash
curl -X POST https://compliance.example.com/internal/jobs/daily-compliance \
  -H 'content-type: application/json' \
  -H "x-job-secret: $JOB_TRIGGER_SECRET" \
  -d '{}'
```

```json
{ "ran": true, "jobRunId": "…", "durationMs": 104,
  "result": { "statuses": {…}, "reminders": {…}, "snapshots": 3 } }
```

`{"ran": false, "reason": "already-succeeded"}` comes back as **200, not an
error** — a duplicate trigger is expected, and a scheduler that retries on
non-2xx should not be provoked into hammering you.

The secret is compared in constant time and rate-limited to 12 requests a
minute. `.github/workflows/daily-job.yml` is a ready-made caller; note that
GitHub's scheduler is best-effort and can drift several minutes, which is fine
for a daily sweep and not for anything tighter.

### Option C — Supabase pg_cron

Keeps the schedule next to the data, with no extra infrastructure.
`supabase/pg_cron.sql` does all of the below in one idempotent run:

```bash
psql "$DIRECT_URL" \
  -v app_base_url='https://compliance.example.com' \
  -v job_secret='<JOB_TRIGGER_SECRET>' \
  -v cron_schedule='30 2 * * *' \
  -f supabase/pg_cron.sql
```

What it does, if you would rather paste it into the SQL editor:

```sql
-- once per project
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- store the secret in Vault rather than inline in the job definition
select vault.create_secret('<JOB_TRIGGER_SECRET>', 'job_trigger_secret');

select cron.schedule(
  'daily-compliance',
  '30 2 * * *',                      -- pg_cron is UTC; 02:30 UTC = 08:00 IST
  $$
  select net.http_post(
    url     := 'https://compliance.example.com/internal/jobs/daily-compliance',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-job-secret', (select decrypted_secret
                                  from vault.decrypted_secrets
                                  where name = 'job_trigger_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

`pg_net` is fire-and-forget: it records the response but the cron entry
succeeds even if the API returns 500. Watch `net._http_response` — or, better,
monitor `/internal/jobs` as described below.

```sql
select * from cron.job;                                    -- what is scheduled
select * from cron.job_run_details order by start_time desc limit 10;
select id, status_code, created from net._http_response order by created desc limit 10;
```

---

## Step 7 — Verify

```bash
curl -s https://compliance.example.com/health
# {"status":"ok","uptimeSeconds":42,"rules":53}

curl -s https://compliance.example.com/ready
# {"status":"ready","database":"up","storage":"supabase","mail":"smtp"}
```

Check the boot log says `serving the web dashboard`, `using Supabase storage`
and `cron disabled — jobs are expected from an external scheduler`.

Then trigger the job once by hand and confirm it recorded a run:

```bash
curl -s https://compliance.example.com/internal/jobs \
  -H "x-job-secret: $JOB_TRIGGER_SECRET" | jq '{staleHours, last: .lastRun}'
```

---

## Operations

**Monitor the scheduler, not just the app.** A cron that quietly stops firing is
the failure mode nobody notices for a month. `GET /internal/jobs` returns
`staleHours` since the last run — alert when it exceeds ~30, and on any
`lastRun.status == "FAILED"`.

```sql
-- the same view, straight from the database
select "jobName", "scheduledFor", status, "durationMs", "claimedBy", error
from job_runs order by "startedAt" desc limit 20;
```

**Scaling.** The API is stateless, so scale replicas freely — sessions live in
the database and evidence lives in Supabase Storage. Raise `connection_limit`
only in step with the Supabase pool size. The daily job stays a single
scheduled task no matter how many API replicas you run.

**Rollback.** Redeploy the previous image tag. Because migrations are additive,
the old image runs fine against the newer schema — which is exactly why the
expand/contract discipline in Step 4 matters. Prisma has no `migrate down`; a
genuine schema rollback is a new forward migration.

**Backups.** Supabase takes daily backups on paid plans, with PITR available as
an add-on. Before any migration that drops or rewrites data, take a manual
snapshot and confirm you can restore it.

**Log noise.** Logs are structured JSON in production (pino), with
`authorization`, `cookie`, `password` and `token` redacted. Ship them somewhere
queryable; `jobRunId` and `claimedBy` let you trace a failed job to a host.

---

## Pre-launch checklist

- [ ] `ENABLE_CRON=false`, and the boot log confirms cron is disabled
- [ ] Exactly one external scheduler configured, firing at 02:30 UTC
- [ ] `DATABASE_URL` is the pooled string **with `?pgbouncer=true`**
- [ ] `DIRECT_URL` is the session pooler, and only migrations use it
- [ ] `connection_limit` × replica count is under the Supabase pool size
- [ ] JWT secrets are freshly generated, not the `.env.example` placeholders
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-side only, never in the browser bundle
- [ ] The `compliance-evidence` bucket exists and is **private**
- [ ] `CORS_ORIGINS` lists real origins — no `*`
- [ ] SMTP verified: `/ready` reports `"mail":"smtp"`, not `"console"`
- [ ] TLS terminated upstream, with HSTS
- [ ] `/internal/*` reachable only by the scheduler — restrict by IP or keep it off the public ingress if you chose Option A
- [ ] Alert on `staleHours > 30` from `/internal/jobs`
- [ ] Backups on, and a restore actually tested
- [ ] `npm run seed` **not** run against production

---

## Known gaps

Honest about what this does not yet do:

- **No RLS.** Tenant isolation is enforced in the application query layer. Fine
  while Postgres is reached only through this API; add policies before exposing
  the database to anything else.
- **Reminder emails are not retried.** A send failure is recorded as `FAILED` on
  the notification row and surfaces in the job result, but nothing re-attempts
  it. Add a retry sweep, or a provider with its own queue, before relying on
  reminders as the only channel.
- **The daily job scans all organizations in one pass.** Fine into the low
  thousands of companies; beyond that, shard it by organization and run the
  slices in parallel.
- **No per-tenant rate limiting.** Limits are global and per-IP.
