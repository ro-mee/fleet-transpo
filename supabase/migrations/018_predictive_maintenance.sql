-- ============================================
-- MIGRATION 018: Per-Vehicle Service Intervals
--
-- Predictive maintenance needs to answer "when is this vehicle next due"
-- along two independent axes: elapsed days and accumulated kilometres. The
-- existing next_service_date / next_service_mileage columns hold the *answer*
-- but nothing holds the *rule*, so once a service completes there is no way to
-- derive the following one — someone has to retype both fields by hand, and
-- when they don't, the vehicle silently stops being predicted.
--
-- These two columns hold that rule per vehicle. Per-vehicle rather than a
-- policy table keyed on category, because vehiclecategories encodes guest tier
-- (VIP / guest / ops / staff), not mechanical duty cycle — a VIP sedan and an
-- ops sedan share a service interval while a VIP sedan and a VIP coaster do
-- not. Two vans off the same lot also legitimately differ once one draws the
-- airport run: interval is a property of the individual vehicle.
--
-- NULL is meaningful and is NOT the same as 0: it means this axis does not
-- participate in the prediction. A vehicle with service_interval_km NULL is
-- predicted on days alone rather than being treated as due at 0 km. Both NULL
-- yields basis: null and is reported, not silently scored as healthy.
--
-- Purely additive: two nullable columns, one backfill of NULLs only. Alters no
-- existing values. Rollback is two DROP COLUMN statements.
--
-- House convention: guarded ADD COLUMN, wrapped in a transaction.
-- ============================================

BEGIN;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS service_interval_km   INT,
  ADD COLUMN IF NOT EXISTS service_interval_days INT;

COMMENT ON COLUMN vehicles.service_interval_km IS
  'Kilometres between services. NULL = do not predict on mileage.';
COMMENT ON COLUMN vehicles.service_interval_days IS
  'Days between services. NULL = do not predict on elapsed time.';

-- Seed a conventional PMS interval so existing vehicles start predicting
-- immediately. Guarded on IS NULL: a re-apply never clobbers tuned values.
UPDATE vehicles
   SET service_interval_km = 5000
 WHERE service_interval_km IS NULL
   AND deleted_at IS NULL;

UPDATE vehicles
   SET service_interval_days = 180
 WHERE service_interval_days IS NULL
   AND deleted_at IS NULL;

COMMIT;
