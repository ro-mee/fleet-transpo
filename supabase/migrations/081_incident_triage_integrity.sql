-- 081_incident_triage_integrity.sql
--
-- Preserve the intentionally small Open/Resolved incident lifecycle while
-- making triage, accountability, and grounding failures observable.
-- Existing rows are backfilled conservatively: unresolved incidents that
-- require grounding are retriable; resolved rows are treated as complete.

BEGIN;

ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by INT REFERENCES employees(employee_id),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by INT REFERENCES employees(employee_id),
  ADD COLUMN IF NOT EXISTS grounding_status VARCHAR(20) NOT NULL DEFAULT 'Not Required',
  ADD COLUMN IF NOT EXISTS grounding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grounding_error TEXT;

UPDATE driverincidents
   SET resolved_at = COALESCE(resolved_at, updated_at, created_at)
 WHERE status = 'Resolved' AND resolved_at IS NULL;

UPDATE driverincidents
   SET grounding_status = CASE
     WHEN status = 'Resolved'
       AND (severity IN ('Major', 'Critical') OR incident_type ~* '(breakdown|mechanical|engine|flat tire|battery|electrical|overheat)')
       THEN 'Complete'
     WHEN severity IN ('Major', 'Critical')
       OR incident_type ~* '(breakdown|mechanical|engine|flat tire|battery|electrical|overheat)'
       THEN 'Pending'
     ELSE 'Not Required'
   END,
   grounding_completed_at = CASE
     WHEN status = 'Resolved'
       AND (severity IN ('Major', 'Critical') OR incident_type ~* '(breakdown|mechanical|engine|flat tire|battery|electrical|overheat)')
       THEN COALESCE(grounding_completed_at, resolved_at, updated_at, created_at)
     ELSE grounding_completed_at
   END
 WHERE deleted_at IS NULL;

UPDATE driverincidents
   SET severity = 'Minor'
 WHERE severity IS NULL OR severity NOT IN ('Minor', 'Moderate', 'Major', 'Critical');

ALTER TABLE driverincidents DROP CONSTRAINT IF EXISTS chk_driverincidents_severity;
ALTER TABLE driverincidents
  ADD CONSTRAINT chk_driverincidents_severity
  CHECK (severity IN ('Minor', 'Moderate', 'Major', 'Critical'));

ALTER TABLE driverincidents DROP CONSTRAINT IF EXISTS chk_driverincidents_grounding_status;
ALTER TABLE driverincidents
  ADD CONSTRAINT chk_driverincidents_grounding_status
  CHECK (grounding_status IN ('Not Required', 'Pending', 'Complete', 'Failed'));

CREATE INDEX IF NOT EXISTS idx_driverincidents_attention
  ON driverincidents (status, severity, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_driverincidents_grounding_retry
  ON driverincidents (grounding_status, created_at DESC)
  WHERE deleted_at IS NULL AND grounding_status IN ('Pending', 'Failed');

COMMIT;
