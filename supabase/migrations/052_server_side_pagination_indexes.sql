-- Server-side pagination: indexes for list/report queries on trips and the
-- joined lookup tables, so filtered + ordered + paginated reads stay fast
-- instead of scanning the whole table.

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_start
  ON trips (vehicle_id, start_time);

CREATE INDEX IF NOT EXISTS idx_trips_driver_start
  ON trips (driver_id, start_time);

CREATE INDEX IF NOT EXISTS idx_trips_status
  ON trips (trip_status);

CREATE INDEX IF NOT EXISTS idx_trips_created_at
  ON trips (deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatchschedules_request_id
  ON dispatchschedules (request_id);

CREATE INDEX IF NOT EXISTS idx_routes_origin_location
  ON routes (origin_location_id);

CREATE INDEX IF NOT EXISTS idx_routes_destination_location
  ON routes (destination_location_id);