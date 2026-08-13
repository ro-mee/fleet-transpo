-- Drop the Fleet review step: remove "Under Review" / "Approved" / "Rejected"
-- from the transportation-request lifecycle so a request becomes assignable
-- straight from "Pending".
--
-- New chain: Pending -> Scheduled -> Assigned -> In Progress -> Completed
-- Terminal: Completed, Cancelled (Reject folds into Cancelled).
BEGIN;

ALTER TABLE transportation_requests DROP CONSTRAINT IF EXISTS chk_transport_fleet_status;

-- Back-fill existing rows onto the surviving statuses:
--   Under Review -> Pending   (re-enters the chain at the start)
--   Approved     -> Scheduled (resources can still be scheduled/assigned)
--   Rejected     -> Cancelled (declined requests fold into the existing cancel)
UPDATE transportation_requests
   SET fleet_status = CASE fleet_status
        WHEN 'Under Review' THEN 'Pending'
        WHEN 'Approved'    THEN 'Scheduled'
        WHEN 'Rejected'    THEN 'Cancelled'
        ELSE fleet_status
      END
 WHERE fleet_status IN ('Under Review', 'Approved', 'Rejected');

ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_fleet_status
  CHECK (fleet_status IN
    ('Pending', 'Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled'));

COMMIT;