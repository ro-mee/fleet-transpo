-- ============================================
-- MIGRATION 108: arrival geofence radii + GPS trail distance
--
-- PR #3 (Arrival Intelligence) needs per-location geofence radii so the
-- system can answer "nasa pickup na ba? / nasa destination na ba?" and a
-- persisted server-side trail distance for completed trips.
--
-- * locations.pickup_radius_m / dropoff_radius_m — operational tuning, NOT
--   location identity: changing them never versions/retires the row (unlike
--   coordinate changes in PUT /api/locations/[id]).
-- * Radius guard rails: 1..1000 m. A typo must not geofence half of Pasay.
-- * Per-location tuning below is exact-name and a safe no-op when a name is
--   absent (hotel driveway 60 m; airport arrivals pickup 150 m; airport
--   departures dropoff 120 m — terminals are large and GPS drifts under cover).
-- * trips.gps_distance_km — server-derived trail distance at completion; a
--   fallback fill only, never overriding odometer-derived distance.
-- Naturally idempotent: every statement is IF NOT EXISTS / guarded, and the
-- UPDATEs converge (re-running changes nothing once applied).
-- ============================================

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS pickup_radius_m INT DEFAULT 100,
  ADD COLUMN IF NOT EXISTS dropoff_radius_m INT DEFAULT 100;

UPDATE locations SET pickup_radius_m = 100 WHERE pickup_radius_m IS NULL;
UPDATE locations SET dropoff_radius_m = 100 WHERE dropoff_radius_m IS NULL;

ALTER TABLE locations ALTER COLUMN pickup_radius_m SET DEFAULT 100;
ALTER TABLE locations ALTER COLUMN dropoff_radius_m SET DEFAULT 100;
ALTER TABLE locations ALTER COLUMN pickup_radius_m SET NOT NULL;
ALTER TABLE locations ALTER COLUMN dropoff_radius_m SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_locations_geofence_radii') THEN
    ALTER TABLE locations ADD CONSTRAINT chk_locations_geofence_radii
      CHECK (pickup_radius_m > 0 AND pickup_radius_m <= 1000
         AND dropoff_radius_m > 0 AND dropoff_radius_m <= 1000);
  END IF;
END
$$;

-- Hotel driveway: tight curbside, small radius.
UPDATE locations SET pickup_radius_m = 60 WHERE name = 'CoCo Star Hotel';

-- Airport arrivals: large terminals, covered pickup zones, drifting GPS.
UPDATE locations SET pickup_radius_m = 150 WHERE name IN (
  'NAIA Terminal 1 - Arrivals',
  'NAIA Terminal 2 - Arrivals',
  'NAIA Terminal 3 - Arrivals (Bay 9)'
);

-- Airport departures: drop-off curbside.
UPDATE locations SET dropoff_radius_m = 120 WHERE name IN (
  'NAIA Terminal 1 - Departures',
  'NAIA Terminal 2 - Departures',
  'NAIA Terminal 3 - Departures (Bay 9)'
);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS gps_distance_km DECIMAL(10, 2);
