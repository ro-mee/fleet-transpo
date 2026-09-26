-- Notifications: soft delete + 90-day retention purge (2026-09-24)
--
-- deleted_at turns the web DELETE endpoint into a recoverable dismiss and
-- gives mobile the same action it never had (previously mobile could only
-- mark read; web ran a literal DELETE FROM with no soft-delete column at all,
-- unlike employees/trips/drivers).
--
-- Retention: rows dismissed more than p_retention_days ago are hard-deleted
-- by purge_deleted_notifications(), scheduled daily through pg_cron — the
-- same vehicle migration 099 uses, because /api/cron/sync has no external
-- scheduler configured (cron_sync_last_ok stale since 2026-09-06).

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Inbox reads are self-scoped on employee_id OR user_id, exclude dismissed
-- rows, and ORDER BY sent_at DESC LIMIT 50. Partial indexes cover only live
-- rows so dismissed rows never bloat the read path.
CREATE INDEX IF NOT EXISTS idx_notifications_live_employee
  ON notifications (employee_id, sent_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_live_user
  ON notifications (user_id, sent_at DESC)
  WHERE deleted_at IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION purge_deleted_notifications(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
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
$$;

-- Load-bearing: without this the anon role (the public browser key, which
-- authenticates to PostgREST as anon) could EXECUTE the purge via /rpc/.
-- SECURITY INVOKER: the owner (migration connection) and the pg_cron job
-- owner keep EXECUTE; no role elevation anywhere.
REVOKE ALL ON FUNCTION purge_deleted_notifications(integer) FROM PUBLIC, anon, authenticated;

-- Daily purge. The window is interval-based off each row's deleted_at, so
-- the database timezone baked into the cron expression does not matter
-- (contrast a wall-clock "04:00 Manila" schedule, which would be wrong on a
-- server whose timezone differs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-purge') THEN
    PERFORM cron.unschedule('notifications-purge');
  END IF;

  PERFORM cron.schedule('notifications-purge', '41 3 * * *', 'SELECT purge_deleted_notifications(90);');
END $$;

COMMIT;
