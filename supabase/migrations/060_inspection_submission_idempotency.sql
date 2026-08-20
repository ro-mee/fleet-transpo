BEGIN;

ALTER TABLE vehicleinspection
  ADD COLUMN IF NOT EXISTS client_submission_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicleinspection_driver_submission
  ON vehicleinspection(driver_id, client_submission_id)
  WHERE client_submission_id IS NOT NULL;

COMMIT;
