-- MIGRATION 048: Pre-trip gate — link inspections to a trip.
--
-- The driver pre-trip check is per-trip (v1 decision): START TRIP is blocked
-- until a vehicleinspection row with status='Passed' exists for that trip.
-- The mobile inspection screen already POSTs trip_id; this column gives it a
-- home. Idempotent: safe no-op on DBs already ahead of this file.

BEGIN;

ALTER TABLE vehicleinspection
  ADD COLUMN IF NOT EXISTS trip_id INT REFERENCES trips(trip_id);

CREATE INDEX IF NOT EXISTS idx_vehicleinspection_trip
  ON vehicleinspection (trip_id, inspection_date DESC, created_at DESC);

COMMIT;
