BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- The backstop for a duty nobody ended.
--
-- Runs hourly and gates itself on the local hour rather than encoding a time in
-- the schedule: pg_cron schedules in the DATABASE's timezone, so '0 4 * * *'
-- would mean 04:00 somewhere else on a server that is not on Asia/Manila. The
-- same `AT TIME ZONE 'Asia/Manila'` expression every other query in this repo
-- uses is correct whatever the server's zone is.
--
-- Before 04:00 local it does nothing: a driver still on a late shift is not
-- cut off. From 04:00 onward it closes anything older than today, and because
-- the predicate requires time_out IS NULL and end_duty_outcome IS NULL it is
-- idempotent — a missed hour self-heals on the next one.
--
-- The clock is a PARAMETER, defaulted to NOW() so the cron command and every
-- other caller stay argument-free. It exists because the gate cannot otherwise
-- be tested: NOW() is an absolute instant, so setting the session's TimeZone
-- changes how a timestamptz is RENDERED, not what the clock reads. A test that
-- ran before 04:00 Manila would see the sweep correctly do nothing and could not
-- tell that apart from the sweep being broken. scripts/verify-duty-autoclose.mjs
-- drives this parameter instead.
CREATE OR REPLACE FUNCTION public.auto_close_unreported_duties(p_now timestamptz DEFAULT NOW())
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  closed integer;
BEGIN
  IF (p_now AT TIME ZONE 'Asia/Manila')::time < TIME '04:00' THEN
    RETURN 0;
  END IF;

  UPDATE driverattendance
     SET time_out          = NOW(),
         end_duty_outcome  = 'AutoClosed',
         remarks           = COALESCE(remarks || ' | ', '')
                             || 'Auto-closed 04:00: no End Duty report submitted'
   WHERE date < (p_now AT TIME ZONE 'Asia/Manila')::date
     AND time_in IS NOT NULL
     AND time_out IS NULL
     AND end_duty_outcome IS NULL
     AND status IN ('Present','Late','Half-Day');

  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END $$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and `anon`
-- inherits it. PostgREST exposes public functions at /rest/v1/rpc/, so without
-- this anyone holding the anon key — which ships in the browser bundle by
-- design — could close every open duty in the system with one call.
-- db:contract does not inspect function privileges, so this is the only gate
-- that sees it; Task 2 Step 4 verifies it directly.
--
-- The signature must name the parameter's TYPE. A zero-argument signature for a
-- function that takes one raises no error at migration time — it simply revokes
-- nothing, leaving anon able to call it.
REVOKE ALL ON FUNCTION public.auto_close_unreported_duties(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'duty-autoclose-sweep') THEN
    PERFORM cron.unschedule('duty-autoclose-sweep');
  END IF;

  PERFORM cron.schedule('duty-autoclose-sweep', '0 * * * *', 'SELECT public.auto_close_unreported_duties();');
END $$;

COMMIT;
