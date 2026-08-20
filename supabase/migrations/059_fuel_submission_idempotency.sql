BEGIN;

ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS client_submission_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuelrecords_driver_submission
  ON fuelrecords(driver_id, client_submission_id)
  WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL;

COMMIT;
