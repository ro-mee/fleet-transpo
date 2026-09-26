BEGIN;

-- How a duty ended, as a fact rather than a string match on remarks.
--
-- The design note rested on being able to ask "does this duty still owe an End
-- Duty report?". Answering that with `remarks LIKE '%no End Duty report%'` would
-- repeat the mistake validatePostShift already refused for the report text: a
-- sentinel string is indistinguishable from a driver who typed the same words.
--
--   NULL         duty still open, or a row written before this migration.
--                The in-progress state; nothing sets it back to NULL.
--   'Reported'   ended with an End Duty report on file.
--   'NoVehicle'  ended with no vehicle pairing, so no report was possible.
--                The gap endDutyWithReport already records on purpose. Never
--                prompted: there is nothing to report against.
--   'AutoClosed' closed by the nightly sweep because no report arrived. The one
--                state a driver can still resolve by reporting late, which flips
--                it to 'Reported' and leaves both facts in remarks.

ALTER TABLE driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_outcome text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'driverattendance_end_duty_outcome_check'
       AND conrelid = 'driverattendance'::regclass
  ) THEN
    ALTER TABLE driverattendance
      ADD CONSTRAINT driverattendance_end_duty_outcome_check
      CHECK (end_duty_outcome IS NULL OR end_duty_outcome IN ('Reported','NoVehicle','AutoClosed'));
  END IF;
END $$;

COMMIT;
