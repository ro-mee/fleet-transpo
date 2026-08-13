-- ============================================
-- MIGRATION 036: Trip lifecycle + dispatch reassignment statuses
--
-- 1. TRIP STATUS — add the real pickup lifecycle phases:
--    At Pickup / Passenger Onboard / Drop-off.
-- 2. DISPATCH STATUS — include `Pending Reassignment`, which the CHECK from
--    012 excluded even though the incidents flow sets it (so it was silently
--    rejected by the constraint and never persisted).
-- ============================================

-- 1. Trip status: rebuild CHECK with the new lifecycle phases.
ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_trip_status;
ALTER TABLE trips
  ADD CONSTRAINT chk_trip_status
  CHECK (trip_status IN (
    'Assigned', 'Pending', 'Approved',
    'Vehicle Assigned', 'Driver Assigned', 'Dispatched',
    'Driver Accepted', 'Trip Started',
    'At Pickup', 'Passenger Onboard',
    'En Route', 'Drop-off', 'Arrived', 'In Progress',
    'Completed', 'Cancelled'
  ));

-- 2. Dispatch status: allow `Pending Reassignment`.
ALTER TABLE dispatchschedules DROP CONSTRAINT IF EXISTS chk_dispatch_status;
ALTER TABLE dispatchschedules
  ADD CONSTRAINT chk_dispatch_status
  CHECK (status IN ('Scheduled', 'In Progress', 'Pending Reassignment', 'Completed', 'Cancelled'));
