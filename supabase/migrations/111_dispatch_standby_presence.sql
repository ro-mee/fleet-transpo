-- Latest observation metadata, not a new location trail. Old locations remain
-- unqualified until a real observation supplies these fields.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_observed_at timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_received_at timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_accuracy_m numeric;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_source text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_vehicle_id integer REFERENCES vehicles(vehicle_id);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS standby_tracking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS standby_session_family uuid;
-- Separate latest standby coordinates: legacy trip/rescue writers cannot relabel them.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS standby_latitude numeric;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS standby_longitude numeric;
CREATE INDEX IF NOT EXISTS idx_attendance_open_driver
  ON driverattendance (driver_id, time_in DESC) WHERE time_in IS NOT NULL AND time_out IS NULL;
