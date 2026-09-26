BEGIN;

-- The id a no-vehicle close came from, so its retry can be recognised idempotently.
ALTER TABLE public.driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_submission_id text;

-- The arbiter: one submission id closes at most one day for one driver. Partial,
-- because every reported close and every pre-existing row leaves it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_driver_end_duty_submission
  ON public.driverattendance (driver_id, end_duty_submission_id)
  WHERE end_duty_submission_id IS NOT NULL;

COMMIT;
