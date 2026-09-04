-- Physical-response tracking on incidents.
--
-- The incident lifecycle already records the paperwork (acknowledged_at/by,
-- resolved_at/by) but not the physical rescue: what help was dispatched, when
-- it was expected, when it arrived, and whether the driver confirmed they
-- were actually safe before/after closure. These columns close that gap.
-- History rows ride incident_comments (action_type RESPONSE / DRIVER_CONFIRMED
-- / REOPENED), so no new table is needed.

ALTER TABLE public.driverincidents
  ADD COLUMN IF NOT EXISTS response_status varchar(20),
  ADD COLUMN IF NOT EXISTS response_type varchar(50),
  ADD COLUMN IF NOT EXISTS response_details varchar(200),
  ADD COLUMN IF NOT EXISTS response_eta timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by integer,
  ADD COLUMN IF NOT EXISTS driver_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

-- NULL = nothing dispatched yet; otherwise the forward-only rescue ladder.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_driverincidents_response_status'
  ) THEN
    ALTER TABLE public.driverincidents
      ADD CONSTRAINT chk_driverincidents_response_status
      CHECK (response_status IS NULL OR response_status IN ('Dispatched', 'En Route', 'Arrived'));
  END IF;
END
$$;
