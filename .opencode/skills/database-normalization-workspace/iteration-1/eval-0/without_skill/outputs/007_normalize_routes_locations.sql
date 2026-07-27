-- ============================================
-- NORMALIZE ROUTES: EXTRACT LOCATIONS
-- Creates a locations table, migrates existing
-- route origin/destination data, and replaces
-- the text+coord columns with FK references.
-- ============================================

-- 1. Create locations table
CREATE TABLE IF NOT EXISTS locations (
  location_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_locations_name ON locations(name);
CREATE INDEX idx_locations_coords ON locations(latitude, longitude);

-- 2. Add trigger for updated_at
CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Add FK columns to routes (nullable initially for migration)
ALTER TABLE routes
  ADD COLUMN origin_location_id INT REFERENCES locations(location_id),
  ADD COLUMN destination_location_id INT REFERENCES locations(location_id);

-- 4. Migrate existing origin locations
WITH origin_inserts AS (
  INSERT INTO locations (name, latitude, longitude)
  SELECT DISTINCT
    origin,
    origin_latitude,
    origin_longitude
  FROM routes
  WHERE origin IS NOT NULL
    AND deleted_at IS NULL
  RETURNING location_id, name
)
UPDATE routes r
SET origin_location_id = oi.location_id
FROM origin_inserts oi
WHERE r.origin = oi.name
  AND r.deleted_at IS NULL;

-- 5. Migrate existing destination locations
WITH destination_inserts AS (
  INSERT INTO locations (name, latitude, longitude)
  SELECT DISTINCT
    destination,
    destination_latitude,
    destination_longitude
  FROM routes
  WHERE destination IS NOT NULL
    AND deleted_at IS NULL
  RETURNING location_id, name
)
UPDATE routes r
SET destination_location_id = di.location_id
FROM destination_inserts di
WHERE r.destination = di.name
  AND r.deleted_at IS NULL;

-- 6. Set NOT NULL after data is migrated
ALTER TABLE routes
  ALTER COLUMN origin_location_id SET NOT NULL,
  ALTER COLUMN destination_location_id SET NOT NULL;

-- 7. Create indexes on FK columns
CREATE INDEX idx_routes_origin_location ON routes(origin_location_id);
CREATE INDEX idx_routes_destination_location ON routes(destination_location_id);

-- 8. Drop old columns
ALTER TABLE routes
  DROP COLUMN origin,
  DROP COLUMN origin_latitude,
  DROP COLUMN origin_longitude,
  DROP COLUMN destination,
  DROP COLUMN destination_latitude,
  DROP COLUMN destination_longitude;
