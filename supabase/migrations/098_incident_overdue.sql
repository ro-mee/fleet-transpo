-- Add overdue_at to driverincidents to track SLA breaches
ALTER TABLE public.driverincidents
ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ;

-- We don't rely solely on dynamic GET requests for overdue tracking,
-- but a background worker or cron is needed to accurately populate this column at the exact moment of breach.
-- In the absence of a pg_cron or external worker in this environment, 
-- we provide a helper function that can be called by an external scheduler or lazily on read.

CREATE OR REPLACE FUNCTION update_incident_sla_breaches()
RETURNS void AS $$
BEGIN
  UPDATE public.driverincidents
  SET overdue_at = due_at
  WHERE status = 'Open'
    AND due_at IS NOT NULL
    AND due_at < NOW()
    AND overdue_at IS NULL
    AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
