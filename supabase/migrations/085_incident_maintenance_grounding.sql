-- Keep legacy open vehicle-related incidents in the safety queue until their
-- automatic grounding/maintenance workflow has completed.
BEGIN;

UPDATE driverincidents
   SET grounding_status = 'Pending'
 WHERE deleted_at IS NULL
   AND status = 'Open'
   AND requires_vehicle_maintenance
   AND grounding_status = 'Not Required';

COMMIT;
