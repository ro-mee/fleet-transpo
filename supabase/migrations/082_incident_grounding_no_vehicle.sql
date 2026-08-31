-- Incidents without a vehicle cannot trigger grounding automation.
-- Correct the 081 backfill for severe reports that were resolved before a
-- vehicle was attached.
BEGIN;
UPDATE driverincidents
   SET grounding_status = 'Not Required',
       grounding_completed_at = NULL,
       grounding_error = NULL
 WHERE vehicle_id IS NULL
   AND grounding_status IN ('Pending', 'Complete', 'Failed')
   AND deleted_at IS NULL;
COMMIT;
