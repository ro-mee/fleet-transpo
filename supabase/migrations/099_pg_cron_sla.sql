BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'incident-sla-breach-check') THEN
    PERFORM cron.unschedule('incident-sla-breach-check');
  END IF;
  
  PERFORM cron.schedule('incident-sla-breach-check', '* * * * *', 'SELECT update_incident_sla_breaches();');
END $$;

COMMIT;
