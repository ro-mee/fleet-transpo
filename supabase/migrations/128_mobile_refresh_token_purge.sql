-- Mobile refresh tokens: 30-day expired-row purge (2026-09-24)
--
-- Migration 016's maintenance comment said to "schedule this periodically
-- (pg_cron, or a manual run)" and nothing ever did — rotation inserts one row
-- per refresh and revokes the old one, so the table only grows. This is the
-- schedule that comment asked for.
--
-- The window is interval-based off expires_at (same reasoning as migration
-- 127's notifications purge): the DB timezone baked into the cron expression
-- does not matter. The 30-day grace past expires_at keeps recently-expired
-- rows around long enough to investigate a suspected token theft — do not
-- shorten it to "just delete expired" without re-reading migration 016.
--
-- Uses pg_cron (the same vehicle as 099/126/127) because it runs entirely
-- inside the database: no HTTP hop, no CRON_SECRET, no external scheduler.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- SECURITY INVOKER; owner (migration connection) and the pg_cron job owner
-- keep DML. The table has no RLS by design (migration 016) — application code
-- reaches it through the raw pg pool as the owner role. No new EXECUTE surface
-- is created: the DELETE runs inline in the job, not via a callable function,
-- so anon cannot reach it through PostgREST /rpc/.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mobile-refresh-token-purge') THEN
    PERFORM cron.unschedule('mobile-refresh-token-purge');
  END IF;

  PERFORM cron.schedule(
    'mobile-refresh-token-purge',
    '17 4 * * *',
    $job$DELETE FROM mobile_refresh_tokens WHERE expires_at < NOW() - INTERVAL '30 days';$job$
  );
END $$;

COMMIT;
