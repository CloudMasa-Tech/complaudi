-- Lock down the regulatory-watch tables, which shipped without RLS.
--
-- Supabase grants the `anon` and `authenticated` roles full DML on everything
-- in `public` by default, so row-level security is the only thing standing
-- between a table and the internet — and the anon key is published in the
-- browser bundle by design. Prisma creates tables with RLS off, so every new
-- table needs this, which is why 20260903140000_enable_rls and
-- 20260916110500_enable_rls_company_events exist.
--
-- These three were added with the regulatory watch and missed it. Every other
-- table in this database had RLS on; these were readable and writable by
-- anyone holding the anon key. rule_overlays is the one that matters most:
-- refreshOverlays() loads it straight into the compliance engine, so an
-- injected row changes which statutory obligations every tenant is shown.
--
-- No policies, matching all 19 other tables: RLS with no policy denies every
-- anon and authenticated request outright. The API reaches these tables with
-- the service-role key, which bypasses RLS.
ALTER TABLE "regulatory_updates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_change_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_overlays" ENABLE ROW LEVEL SECURITY;
