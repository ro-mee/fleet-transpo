-- ============================================
-- MIGRATION 013: Add "Registration Expired" vehicle status
--
-- Adds a distinct vehicle status for vehicles whose
-- LTO registration has passed its expiry date.
-- ============================================

ALTER TABLE vehicles DROP CONSTRAINT chk_vehicle_status;

ALTER TABLE vehicles
  ADD CONSTRAINT chk_vehicle_status
  CHECK (vehicle_status IN ('Available', 'Reserved', 'In Use', 'Under Maintenance', 'Decommissioned', 'Registration Expired'));
