-- 064_driver_suspension_reason.sql
--
-- Gives the compliance suspension an inverse. Until now syncDriverStatus
-- flipped drivers to 'Suspended' when their license expired and nothing ever
-- restored them — renewing the license left the flag stuck because the system
-- could not tell a compliance suspension from a disciplinary one.
--
-- suspension_reason records WHY a driver is suspended:
--   'license_expired'  set by the automatic compliance sync; safe to auto-
--                      reinstate once a valid license expiry is saved
--   NULL               manual/legacy suspensions (or not suspended); never
--                      auto-restored by code
--
-- Backfill attributes existing expired-license rows, which are safe to claim:
-- the compliance sync is the only writer of Suspended in the codebase.
--
-- Idempotent throughout.

BEGIN;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(50);

UPDATE drivers
   SET suspension_reason = 'license_expired'
 WHERE deleted_at IS NULL
   AND driver_status = 'Suspended'
   AND license_expiry < CURRENT_DATE
   AND suspension_reason IS NULL;

COMMIT;
