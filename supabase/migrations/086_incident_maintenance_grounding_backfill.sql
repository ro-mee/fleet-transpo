-- The 084 backfill created active work orders and took their vehicles out of
-- service. Mark those legacy rows complete so they are not left in a retry-only
-- state when no grounding attempt is still running.
BEGIN;

UPDATE driverincidents
   SET grounding_status = 'Complete',
       grounding_completed_at = COALESCE(grounding_completed_at, NOW()),
       grounding_error = NULL,
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND status = 'Open'
   AND requires_vehicle_maintenance
   AND maintenance_id IS NOT NULL
   AND grounding_status = 'Pending';

COMMIT;
