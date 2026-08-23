-- 062_driverincidents_resolution_integrity.sql
--
-- Closes the incident resolution gaps between the admin registry and the
-- mobile driver app:
--
--   1. Offline-submission idempotency. The driver app queues incident POSTs
--      when offline (mobile/lib/sync.js) and replays them on reconnect; a
--      replay racing a manual resubmit created duplicate reports, each re-
--      running vehicle grounding. Mirrors the fuel/inspection pattern from
--      migrations 059/060: a client-generated submission id + unique partial
--      index makes the replay a no-op.
--
--   2. A closed status vocabulary. Code only ever produces Open (the column
--      default) and Resolved; stray "Pending" values predate migration 030.
--      The CHECK turns any future typo into a DB error instead of a silently
--      unfilterable row.
--
-- Idempotent throughout: every statement is a safe no-op on a database that
-- already has the column/index/constraint.

BEGIN;

ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS client_submission_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_driverincidents_driver_submission
  ON driverincidents(driver_id, client_submission_id)
  WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL;

-- Normalize legacy values before the constraint lands.
UPDATE driverincidents
   SET status = CASE
         WHEN lower(status) = 'resolved' THEN 'Resolved'
         WHEN actions_taken IS NOT NULL AND NULLIF(btrim(actions_taken), '') IS NOT NULL THEN 'Resolved'
         ELSE 'Open'
       END,
       updated_at = NOW()
 WHERE lower(status) NOT IN ('open', 'resolved');

ALTER TABLE driverincidents DROP CONSTRAINT IF EXISTS chk_driverincidents_status;
ALTER TABLE driverincidents
  ADD CONSTRAINT chk_driverincidents_status
  CHECK (status IN ('Open', 'Resolved'));

COMMIT;
