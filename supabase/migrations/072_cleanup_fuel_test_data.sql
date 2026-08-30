-- ==========================================
-- 072: Fuel Test Data Cleanup & Analytics Indexes
-- ==========================================

BEGIN;

-- 1. Soft-delete E2E test artifacts
UPDATE fuelrecords
SET deleted_at = NOW()
WHERE client_submission_id LIKE '%-test%'
   OR client_submission_id LIKE 'sub-%'
   AND deleted_at IS NULL;

UPDATE fuelrequests
SET status = 'Rejected', review_notes = 'Test artifact cleanup'
WHERE client_submission_id LIKE '%-test%'
   OR client_submission_id LIKE 'sub-%';

-- 2. Add performance indexes for analytics
CREATE INDEX IF NOT EXISTS idx_fuelrecords_analytics 
ON fuelrecords (vehicle_id, fuel_date, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_analytics 
ON trips (vehicle_id, start_time, trip_status) WHERE deleted_at IS NULL;

COMMIT;
