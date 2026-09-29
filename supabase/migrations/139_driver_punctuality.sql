-- 139_driver_punctuality.sql
-- Authoritative pickup-arrival timestamp for Driver Punctuality.
-- Written server-side by setTripStatus() on transition to 'At Pickup',
-- first-write-wins so retries never rewrite history.
-- at_pickup_override marks arrivals recorded with geofence_override=true
-- (claimed, not geofence-proven) so the report can separate them.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS at_pickup_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS at_pickup_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_trips_at_pickup
  ON public.trips (at_pickup_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_driver_completed_end
  ON public.trips (driver_id, end_time)
  WHERE trip_status = 'Completed' AND deleted_at IS NULL;
