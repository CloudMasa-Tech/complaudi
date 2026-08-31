-- ============================================================================
-- Supabase provisioning for the Compliance Toolkit — evidence storage bucket.
--
-- Idempotent: safe to run on a fresh project, after a config change, or twice
-- by accident. It creates nothing outside the `storage` schema and touches no
-- application table, so it cannot collide with Prisma's migration history.
--
-- Run it against the DIRECT (session) connection, not the pooler:
--
--     npm run supabase:bootstrap
--     # or
--     psql "$DIRECT_URL" -f supabase/setup.sql
--     # or paste into the Supabase dashboard SQL editor
--
-- Scheduling the daily job with pg_cron is a separate, optional step —
-- see DEPLOYMENT.md, "Option C — Supabase pg_cron".
-- ============================================================================

\set ON_ERROR_STOP on

-- ── the bucket ───────────────────────────────────────────────────────────────
--
-- Private. The API issues 5-minute signed URLs (src/lib/storage.ts); a public
-- bucket would make every tenant's evidence readable by anyone who guesses a
-- key, and keys are predictable enough to matter.
--
-- The limit and MIME list mirror src/modules/documents/documents.routes.ts.
-- They are a second line of defence, not the primary one: the API rejects a bad
-- upload before it reaches storage, and also sniffs magic bytes rather than
-- trusting the declared Content-Type (src/lib/fileInspection.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-evidence',
  'compliance-evidence',
  false,
  26214400,  -- 25 MiB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/csv',
    'text/plain',
    'application/zip',
    'application/xml',
    'text/xml'
  ]::text[]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── access ───────────────────────────────────────────────────────────────────
--
-- Deliberately no policies on storage.objects for this bucket.
--
-- The API is the only client. It connects with the service_role key, which
-- bypasses row-level security, and enforces tenant isolation in its query
-- layer: every read is scoped by organizationId, and keys are namespaced
-- orgs/<org>/companies/<company>/... so a bucket listing cannot cross tenants.
--
-- Adding a permissive policy here would hand that isolation to Postgres, which
-- has no idea who the caller is — this app does not use Supabase Auth, so
-- auth.uid() is always null and any `authenticated` policy is effectively
-- "anyone with the anon key". If you ever let a browser talk to Storage
-- directly, write real policies first.
do $$
begin
  if not (
    select relrowsecurity from pg_class
    where oid = 'storage.objects'::regclass
  ) then
    raise warning
      'row-level security is OFF on storage.objects — the anon key can read every tenant''s evidence. Enable it before going live.';
  end if;
end $$;

-- Report any policy that could expose the bucket to a non-service role, so a
-- leftover "allow public read" from dashboard experimentation is not silent.
do $$
declare
  n integer;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'storage'
    and tablename  = 'objects'
    and (qual like '%compliance-evidence%' or with_check like '%compliance-evidence%');

  if n > 0 then
    raise warning
      '% policy/policies on storage.objects reference compliance-evidence. Review them: this app expects service_role-only access.', n;
  end if;
end $$;

-- ── verify ───────────────────────────────────────────────────────────────────
select
  id                                    as bucket,
  case when public then 'PUBLIC — fix this' else 'private' end as visibility,
  pg_size_pretty(file_size_limit::bigint) as file_size_limit,
  array_length(allowed_mime_types, 1)     as allowed_mime_types
from storage.buckets
where id = 'compliance-evidence';
