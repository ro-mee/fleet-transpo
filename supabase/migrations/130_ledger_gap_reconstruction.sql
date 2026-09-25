-- RECONSTRUCTION, NOT RECOVERED HISTORY.
--
-- Six migrations were applied to this project and their files no longer exist
-- anywhere: `121_end_duty_maintenance_source`, `125_end_duty_outcome`,
-- `126_duty_autoclose`, `127_notifications_soft_delete_retention`,
-- `128_mobile_refresh_token_purge` and `129_end_duty_submission_id`. They are
-- not in git on any branch, local or remote, and `git log --all -- <glob>`
-- returns nothing for all six. `schema_migrations` holds a checksum per name,
-- and a checksum cannot be inverted, so the originals are unrecoverable.
--
-- The consequence being fixed here: a database built by replaying
-- `supabase/migrations/` in order does NOT match the live database, because the
-- seven object-groups below exist on live and no file creates them. This file
-- re-creates them from what the live catalog still describes — `schema.sql` for
-- the structure, `pg_get_functiondef` for the two function bodies, `cron.job`
-- for the three schedules.
--
-- It is written to be a NO-OP on live. Every statement is guarded, so applying
-- it to the database it was derived from changes nothing; it only takes effect
-- on a database that is missing the objects. That is deliberate: this is a
-- reconstruction from residue, and a reconstruction must not be able to damage
-- the thing it was copied from.
--
-- WHAT THIS CANNOT PROVE. The ledger stores a checksum, not content, so there
-- is no way to know whether any of the six also did something that leaves no
-- structural trace — a data backfill, an RLS policy, a grant. Migration `063`,
-- the shipped twin of `121`, did exactly that: it carried an `UPDATE` backfilling
-- from a description regex. If any of these six did likewise, the gap this file
-- closes is only the visible part of it. `121` in particular is inferred from
-- three objects in `schema.sql` plus its filename; its contents are not known.
--
-- Version 130 is the first free number: the ledger's highest is 129, and the
-- renumbered/incomplete state of 113-116 is recorded separately. Do not rename
-- this to any of the six above — the ledger holds checksums for those names and
-- a differing file would surface as `changed`.

BEGIN;

-- ── 121_end_duty_maintenance_source ─────────────────────────────────────────
-- A maintenance record arising from a vehicle inspection, the sibling of
-- `source_incident_id` (063, made unique in 083). One inspection must not
-- produce two work orders, hence the same partial-unique shape as the incident
-- pair. The inline REFERENCES reproduces 063's idiom: the column and its
-- constraint are created together, and a no-op when the column already exists.
ALTER TABLE vehiclemaintenance
  ADD COLUMN IF NOT EXISTS source_inspection_id INT REFERENCES vehicleinspection(inspection_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiclemaintenance_source_inspection
  ON vehiclemaintenance(source_inspection_id)
  WHERE source_inspection_id IS NOT NULL;

-- ── 125_end_duty_outcome ────────────────────────────────────────────────────
-- How a duty ended. 'AutoClosed' is written by `auto_close_unreported_duties`
-- below; 'Reported' and 'NoVehicle' are the driver-initiated paths.
ALTER TABLE driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_outcome text;

-- The three-value CHECK is added under a guard because ADD CONSTRAINT has no
-- IF NOT EXISTS form. `IN (...)` is the same predicate as the `= ANY (ARRAY[...])`
-- the live catalog stores — Postgres normalises one to the other.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'driverattendance'::regclass
       AND conname  = 'driverattendance_end_duty_outcome_check'
  ) THEN
    ALTER TABLE driverattendance
      ADD CONSTRAINT driverattendance_end_duty_outcome_check
      CHECK (end_duty_outcome IS NULL OR end_duty_outcome IN ('Reported', 'NoVehicle', 'AutoClosed'));
  END IF;
END $$;

-- ── 126_duty_autoclose ──────────────────────────────────────────────────────
-- Closes any duty left open past 04:00 Asia/Manila. Body reproduced verbatim
-- from `pg_get_functiondef` on live; the 04:00 guard is inside the function so
-- the schedule below can run every hour without acting before the cutoff.
CREATE OR REPLACE FUNCTION public.auto_close_unreported_duties(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
END $function$;

-- ── 127_notifications_soft_delete_retention ─────────────────────────────────
-- Soft-deleted notifications are hidden rather than removed, so the live feed
-- needs the partial indexes and the retention job needs a purge.
CREATE OR REPLACE FUNCTION public.purge_deleted_notifications(p_retention_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RETURN 0;
  END IF;

  DELETE FROM notifications
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - make_interval(days => p_retention_days);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Both indexes are partial on `deleted_at IS NULL`, which is what makes them
-- the live-feed indexes rather than duplicates of a plain (employee_id) index.
CREATE INDEX IF NOT EXISTS idx_notifications_live_employee
  ON notifications(employee_id, sent_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_live_user
  ON notifications(user_id, sent_at DESC)
  WHERE deleted_at IS NULL;

-- ── 129_end_duty_submission_id ──────────────────────────────────────────────
-- Client-supplied id, so a retried End Duty from the mobile queue cannot close
-- the same duty twice. Same shape as the `client_submission_id` pairings in
-- 060/069/072 and the `*_driver_submission` indexes they left behind.
ALTER TABLE driverattendance
  ADD COLUMN IF NOT EXISTS end_duty_submission_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_driver_end_duty_submission
  ON driverattendance(driver_id, end_duty_submission_id)
  WHERE end_duty_submission_id IS NOT NULL;

-- ── 126, 127, 128 — the schedules ───────────────────────────────────────────
-- `schema.sql` does not capture `cron.job`: the dump covers the `public` schema
-- and these jobs live in `cron`. All three were invisible to every artifact in
-- this repo, which is why 128 in particular left no trace at all — an inline
-- DELETE with no function and no schema change.
--
-- The names below are the ones live already uses. An earlier draft of this file
-- invented its own names and guarded on command text alone, because `jobname`
-- had never actually been queried when it was written — only `command` and
-- `schedule` had been. Applying it showed the guard worked, in that no job was
-- duplicated, but that the three would have been created under the wrong names
-- on a fresh database. Both are checked now, name OR command, so a job is
-- recognised whether it is found by its identity or by what it runs.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'duty-autoclose-sweep'
        OR command LIKE '%auto_close_unreported_duties%'
  ) THEN
    PERFORM cron.schedule('duty-autoclose-sweep', '0 * * * *',
      'SELECT public.auto_close_unreported_duties();');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'notifications-purge'
        OR command LIKE '%purge_deleted_notifications%'
  ) THEN
    PERFORM cron.schedule('notifications-purge', '41 3 * * *',
      'SELECT purge_deleted_notifications(90);');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'mobile-refresh-token-purge'
        OR command LIKE '%mobile_refresh_tokens%'
  ) THEN
    PERFORM cron.schedule('mobile-refresh-token-purge', '17 4 * * *',
      $cmd$DELETE FROM mobile_refresh_tokens WHERE expires_at < NOW() - INTERVAL '30 days';$cmd$);
  END IF;
END $$;

COMMIT;
