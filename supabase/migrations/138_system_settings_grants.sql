BEGIN;

-- ============================================
-- MIGRATION 138: revoke the PostgREST grants on system_settings
--
-- Measured live on 2026-09-28, not read off a migration: `anon` and
-- `authenticated` each held DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE and UPDATE on `system_settings`, against `relrowsecurity = true`
-- and ZERO policies. Every earlier grant fix (116, 117, 119, 122, 123) missed
-- this table.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS
-- -----------------------------------
-- RLS does NOT apply to TRUNCATE. With `TRUNCATE` granted, the public anon
-- key — which ships in the browser bundle by design — could empty
-- `system_settings` in one statement, silently resetting dispatch_policy,
-- uvvrp_policy and hotel_location to code defaults. That is a data-destruction
-- hole, not a read hole, which is why `verify:anon` reports INCONCLUSIVE here
-- rather than EXPOSED: rows are filtered by the empty-policy RLS, so the probe
-- sees `200 []` and cannot distinguish "protected" from "empty". The contract
-- (`npm run db:contract`) is what resolves that, and its line called out the
-- write grants but not TRUNCATE.
--
-- `postgres` and `service_role` keep their grants: `DATABASE_URL`
-- authenticates as `postgres` (BYPASSRLS) and is the only path the
-- application uses, and `service_role` is the Supabase server-side key.
-- Revoke is scoped to the two public PostgREST roles, matching 116/119.
--
-- This table now becomes the store for `security_policy` (session timeout,
-- lockout), which makes closing it a prerequisite rather than a cleanup.
--
-- Idempotent: REVOKE of a privilege not held is a no-op.
-- ============================================

REVOKE ALL PRIVILEGES ON public.system_settings FROM anon, authenticated;

COMMIT;
