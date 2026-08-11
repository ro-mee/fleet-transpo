-- ============================================
-- MIGRATION 035: Backfill assistance_needed
--
-- Purpose:
--   The driverincidents.assistance_needed text[]
--   column exists on the live database and holds
--   data, but no migration ever declared it. It
--   was added by the now-deleted root script
--   migrate_incidents.js, which ran inline DDL
--   with no migration file. A replay from
--   migrations therefore lacked the column while
--   the app's incident flow writes to it.
--
-- Idempotent: IF NOT EXISTS, no-op on the live DB.
-- ============================================

BEGIN;

ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS assistance_needed text[];

COMMIT;
