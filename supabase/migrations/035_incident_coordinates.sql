-- 029_incident_coordinates.sql
-- Capture GPS coordinates when a driver reports an incident so dispatch can
-- see emergency locations on the live map (red blinking Critical/Major
-- markers) and the incidents registry page.

ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);
