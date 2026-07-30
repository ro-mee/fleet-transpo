-- ============================================
-- MIGRATION 012: Status CHECK Constraints
--
-- Purpose:
--   Add CHECK constraints on all status columns
--   to prevent invalid status values at the DB
--   level. Migrate existing rows that use old
--   status values to the corrected ones.
-- ============================================

-- ============================================
-- 1. VEHICLE STATUS
-- Old: "Dispatched" → "In Use"
-- ============================================

UPDATE vehicles SET vehicle_status = 'In Use'
WHERE vehicle_status = 'Dispatched';

ALTER TABLE vehicles
  ADD CONSTRAINT chk_vehicle_status
  CHECK (vehicle_status IN ('Available', 'Reserved', 'In Use', 'Under Maintenance', 'Decommissioned'));

-- ============================================
-- 2. DRIVER STATUS
-- All current values are valid.
-- ============================================

ALTER TABLE drivers
  ADD CONSTRAINT chk_driver_status
  CHECK (driver_status IN ('Available', 'On Trip', 'Off Duty', 'On Leave', 'Suspended'));

-- ============================================
-- 3. RESERVATION STATUS
-- All current values are valid.
-- ============================================

ALTER TABLE vehiclereservations
  ADD CONSTRAINT chk_reservation_status
  CHECK (status IN ('Pending', 'Approved', 'Dispatched', 'Completed', 'Cancelled', 'Rejected'));

-- ============================================
-- 4. DISPATCH STATUS
-- Old: "Pending" → "Scheduled", "Approved" → "Scheduled",
-- "Dispatched" → "Scheduled", "Driver Accepted" → "In Progress",
-- "En Route" → "In Progress"
-- ============================================

UPDATE dispatchschedules SET status = 'Scheduled'
WHERE status IN ('Pending', 'Approved', 'Dispatched');

UPDATE dispatchschedules SET status = 'In Progress'
WHERE status IN ('Driver Accepted', 'En Route');

ALTER TABLE dispatchschedules
  ADD CONSTRAINT chk_dispatch_status
  CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'Cancelled'));

-- ============================================
-- 5. TRIP STATUS
-- Keep existing states (mobile app may use them).
-- ============================================

ALTER TABLE trips
  ADD CONSTRAINT chk_trip_status
  CHECK (trip_status IN ('Assigned', 'Pending', 'Approved', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted', 'Trip Started', 'En Route', 'Arrived', 'In Progress', 'Completed', 'Cancelled'));
