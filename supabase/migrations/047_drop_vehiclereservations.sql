-- 036: Drop the legacy `vehiclereservations` table and both `reservation_id` FKs.
--
-- Migration 016 moved the product to `transportation_requests`; the old table was
-- never dropped. It has sat at 0 rows since, while `dispatchschedules` and
-- `transportation_requests` each carried a nullable `reservation_id` FK pointing
-- at it. That second parent was the schema's worst trap: sync helpers in
-- `src/services/status.service.js` keyed on `reservation_id`, so they matched no
-- live row and failed silently. Those helpers are deleted in this same change.
--
-- Verified against the live DB before writing this (dnxuphhxlzidvwtdqqkq/public):
--   vehiclereservations                                    0 rows (incl. soft-deleted)
--   dispatchschedules WHERE reservation_id IS NOT NULL      0 rows
--   transportation_requests WHERE reservation_id IS NOT NULL 0 rows
--   integration_log WHERE reference_type = 'reservation'    0 rows
--   views depending on vehiclereservations                  none
--
-- Idempotent: every statement is IF EXISTS, so this is a safe no-op on a DB that
-- is already ahead of the files.

-- 1. FK constraints pointing at the legacy table.
ALTER TABLE IF EXISTS dispatchschedules
  DROP CONSTRAINT IF EXISTS dispatchschedules_reservation_id_fkey;
ALTER TABLE IF EXISTS transportation_requests
  DROP CONSTRAINT IF EXISTS transportation_requests_reservation_id_fkey;

-- 2. The dead second parent on both live tables, and their indexes.
DROP INDEX IF EXISTS idx_dispatch_reservation;
DROP INDEX IF EXISTS idx_transport_requests_reservation;
ALTER TABLE IF EXISTS dispatchschedules DROP COLUMN IF EXISTS reservation_id;
ALTER TABLE IF EXISTS transportation_requests DROP COLUMN IF EXISTS reservation_id;

-- 3. The table itself. CASCADE clears its own triggers, policies, indexes, and
--    the owned sequence; nothing outside it depends on the table (verified above).
DROP TABLE IF EXISTS vehiclereservations CASCADE;

-- 4. Trigger functions that existed only to serve that table. Both are dropped
--    without CASCADE on purpose: if either is somehow still attached to another
--    table, this migration must fail loudly rather than silently remove a live
--    trigger. Verified: the only triggers using them were on vehiclereservations,
--    dropped in step 3.
DROP FUNCTION IF EXISTS public.log_reservation_integration();
DROP FUNCTION IF EXISTS public.notify_reservation_approved();
