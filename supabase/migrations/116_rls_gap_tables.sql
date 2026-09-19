BEGIN;

-- ============================================
-- MIGRATION 116: the RLS gap tables, and a view that bypassed RLS entirely
--
-- Closes the remainder of SEC-DB-003 and all of SEC-DB-006. Confirmed live on
-- 2026-09-18 by measurement, not by reading migrations.
--
-- WHAT WAS ACTUALLY OBSERVED
-- --------------------------
-- `npm run verify:anon` probes with nothing but the public anon key — the key
-- that ships in the browser bundle by design. `npm run db:contract` reads the
-- live catalog to explain what the probe cannot. Together, before this
-- migration:
--
--   ai_prompt_templates   RLS DISABLED, anon holds SELECT/INSERT/UPDATE/DELETE.
--                         Probe returned `200 []` — an EMPTY TABLE, not a
--                         protected one. (SEC-DB-003, created by 106.)
--   trip_monitor_alerts   Same: RLS DISABLED, full anon grants, `200 []` on an
--                         empty table. (SEC-DB-003, created by 109.)
--   driver_stats          A VIEW. `reloptions` was null, so it had no
--                         `security_invoker` and executed as its OWNER — read
--                         straight through the RLS protecting `trips` and
--                         `drivers`. anon held SELECT. This one had REAL ROWS:
--                         a direct role-switch measurement returned 40 rows,
--                         every driver's performance record. (SEC-DB-006.)
--
-- The earlier report called driver_stats "1 row readable" because the probe
-- used `limit=1`. 40 is the measured count.
--
-- WHY RLS ALONE WAS NOT ENOUGH — the TRUNCATE hole
-- -----------------------------------------------
-- Row security does not apply to TRUNCATE. Both tables granted anon TRUNCATE,
-- so `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on its own would have stopped
-- reads and writes while leaving an anonymous caller able to EMPTY THE TABLE.
-- That is why this migration revokes the grants as well; the two mechanisms
-- cover different things and neither is sufficient alone.
--
-- WHY THIS IS SAFE FOR THE APPLICATION — measured, not argued
-- ----------------------------------------------------------
-- The app reaches Postgres one way: `query()` in src/lib/db.js, over
-- `DATABASE_URL`, which authenticates as `postgres`. Verified against live:
--
--   current_user = postgres,  rolbypassrls = true
--
-- A role with BYPASSRLS never has row security evaluated against it, so
-- enabling RLS cannot change a single row the application sees. Every reader of
-- these three objects goes through that pool:
--
--   ai_prompt_templates  src/lib/ai/prompt-loader.js:24,
--                        src/app/api/ai/instructions/route.js (GET/PUT/DELETE)
--   trip_monitor_alerts  src/services/live-trip-monitor.service.js,
--                        src/services/trip-lifecycle.service.js
--   driver_stats         src/app/api/driver/me/route.js:66,
--                        src/app/api/drivers/[id]/route.js:63
--
-- The only importer of the browser Supabase client is src/hooks/use-realtime.js,
-- and nothing imports that hook. `supabase_realtime` exists but contains zero
-- tables, so there is no Realtime subscription to break.
--
-- REHEARSED BEFORE APPLYING. Both the proposed changes and the application's
-- real twelve read/write queries were run against live inside a single
-- transaction that was then ROLLED BACK: 12 of 12 queries returned identical
-- results, rollback was verified (RLS flags, reloptions and every grant
-- restored, zero stray rows), and a role-switch probe inside that transaction
-- went from `driver_stats: 40 rows visible` to `42501 permission denied` on all
-- three objects.
--
-- Deliberately NO policies, and deliberately NOT `FORCE ROW LEVEL SECURITY`:
-- deny-all is the intent for every non-bypassing role, and forcing would remove
-- the owner exemption for no benefit.
--
-- NOTE ON THE REVOKE: only table-level privileges are revoked. Verified against
-- live that no column carries its own ACL (`pg_attribute.attacl` is NULL
-- everywhere on these objects), so the column-level grants that
-- `information_schema.column_privileges` reports are DERIVED from the
-- table-level ones and are removed with them.
--
-- service_role is left alone — it is a different credential, is not subject to
-- these roles, and src/lib/db.js:getAdminClient() uses it for storage.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op where already enabled,
-- SET (security_invoker) is a no-op where already set, and REVOKE of a
-- privilege not held is a no-op.
-- ============================================

-- SEC-DB-003 remainder — two tables created after 100 never got RLS.
ALTER TABLE IF EXISTS public.ai_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trip_monitor_alerts ENABLE ROW LEVEL SECURITY;

-- SEC-DB-006 — make the view run as its caller, so the base-table RLS that
-- protects `trips` and `drivers` applies to whoever queries it.
ALTER VIEW IF EXISTS public.driver_stats SET (security_invoker = true);

-- Close the grant path too. RLS does not cover TRUNCATE, and an empty table
-- that anon may read is one INSERT away from being exposed.
REVOKE ALL PRIVILEGES ON public.ai_prompt_templates FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.trip_monitor_alerts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.driver_stats        FROM anon, authenticated;

COMMIT;
