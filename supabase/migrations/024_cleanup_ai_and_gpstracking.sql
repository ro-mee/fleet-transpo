-- ============================================
-- MIGRATION 019: Drop vehiclereservations.ai_* + gpstracking.driver_id
--
-- Purpose:
--   Two cleanup items deferred from the 018 decision, now resolved:
--
--   1. vehiclereservations.ai_vehicle_recommendation / ai_driver_recommendation
--      (from migration 001). Fully dead: no route, service, or page reads OR
--      writes them. The live recommendation cache that matters lives on
--      transportation_requests.ai_vehicle_recommendation / ai_driver_recommendation,
--      which the reservation detail page now actually reads (saved-recommendation
--      card). The vehiclereservations copies are 001-era residue with no writer.
--
--   2. gpstracking.driver_id. Written on every GPS insert (mobile driver gps
--      route + trips/[id]/locations alias) but never read: queries filter on
--      vehicle_id and trip_id only. It is a redundant FK — the driver is
--      derivable from the trip. Dropping it removes an update-anomaly vector
--      (a row could claim a driver that does not match its trip) and shaves one
--      column + FK check off every high-frequency GPS write.
--
--   Deferred/kept deliberately:
--     - transportation_requests.ai_vehicle_recommendation / ai_driver_recommendation
--       are KEPT — B1 turned them into a read (the reservation page renders the
--       recorded pick), so they are no longer write-only.
--
-- ============================================

BEGIN;

-- ============================================
-- 1. vehiclereservations.ai_vehicle_recommendation / ai_driver_recommendation
-- ============================================
-- Removed alongside the two GPS INSERT statements in the app (which must match
-- this migration). IF EXISTS guards make a re-run a no-op.

ALTER TABLE vehiclereservations DROP COLUMN IF EXISTS ai_vehicle_recommendation;
ALTER TABLE vehiclereservations DROP COLUMN IF EXISTS ai_driver_recommendation;

-- ============================================
-- 2. gpstracking.driver_id
-- ============================================

-- The column is referenced by its own FK, so drop the constraint first (a bare
-- DROP COLUMN would fail on the dependency; IF EXISTS keeps a re-run a no-op).
ALTER TABLE gpstracking DROP CONSTRAINT IF EXISTS gpstracking_driver_id_fkey;

-- The INSERT policy used driver_id to prove the sample belongs to the calling
-- driver. Rewrite it to derive the driver from the trip instead: a driver may
-- insert GPS only for a trip that is assigned to them (admin/system_admin still
-- bypass). Same semantic as before, minus the now-dropped column.
ALTER TABLE gpstracking DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can insert GPS" ON gpstracking;
CREATE POLICY "Drivers can insert GPS"
  ON gpstracking FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.trip_id = gpstracking.trip_id
         AND t.driver_id = (SELECT d.driver_id
                              FROM drivers d
                              JOIN employees e ON d.employee_id = e.employee_id
                             WHERE e.user_id = auth.uid())
    )
    OR has_role(ARRAY['admin', 'system_admin'])
  );
ALTER TABLE gpstracking ENABLE ROW LEVEL SECURITY;

ALTER TABLE gpstracking DROP COLUMN IF EXISTS driver_id;

-- ============================================
-- 3. VERIFICATION NOTES
-- ============================================
-- * vehiclereservations.ai_* — no index, trigger, view, RLS policy, or app code
--   references either column (verified by grep + pg_index/pg_views).
-- * gpstracking.driver_id — dropped from the two INSERT statements in
--   src/app/api/trips/[id]/locations/route.js and
--   src/app/api/mobile/driver/trips/[id]/gps/route.js in the same change.

COMMIT;