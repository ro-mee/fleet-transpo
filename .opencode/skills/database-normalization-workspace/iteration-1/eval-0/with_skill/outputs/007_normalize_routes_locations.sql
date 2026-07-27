-- ============================================
-- NORMALIZE ROUTES: Extract locations into separate table
-- ============================================

-- 1. Create locations table
CREATE TABLE IF NOT EXISTS locations (
  location_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add nullable FK columns to routes
ALTER TABLE routes
  ADD COLUMN origin_location_id INT,
  ADD COLUMN destination_location_id INT;

-- 3. Migrate existing distinct origins into locations table
INSERT INTO locations (name, latitude, longitude)
SELECT DISTINCT ON (r.origin) r.origin, r.origin_latitude, r.origin_longitude
FROM routes r
WHERE r.origin IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.name = r.origin);

-- 4. Migrate existing distinct destinations not yet inserted
INSERT INTO locations (name, latitude, longitude)
SELECT DISTINCT ON (r.destination) r.destination, r.destination_latitude, r.destination_longitude
FROM routes r
WHERE r.destination IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.name = r.destination);

-- 5. Update routes with FK references to locations
UPDATE routes r
SET origin_location_id = l.location_id
FROM locations l
WHERE l.name = r.origin;

UPDATE routes r
SET destination_location_id = l.location_id
FROM locations l
WHERE l.name = r.destination;

-- 6. Add NOT NULL constraints and foreign keys
ALTER TABLE routes
  ALTER COLUMN origin_location_id SET NOT NULL,
  ALTER COLUMN destination_location_id SET NOT NULL;

ALTER TABLE routes
  ADD CONSTRAINT fk_routes_origin_location
  FOREIGN KEY (origin_location_id) REFERENCES locations(location_id);

ALTER TABLE routes
  ADD CONSTRAINT fk_routes_destination_location
  FOREIGN KEY (destination_location_id) REFERENCES locations(location_id);

-- 7. Drop old denormalized columns
ALTER TABLE routes
  DROP COLUMN origin,
  DROP COLUMN origin_latitude,
  DROP COLUMN origin_longitude,
  DROP COLUMN destination,
  DROP COLUMN destination_latitude,
  DROP COLUMN destination_longitude;

-- 8. Add indexes on FK columns for join performance
CREATE INDEX idx_routes_origin_location ON routes(origin_location_id);
CREATE INDEX idx_routes_destination_location ON routes(destination_location_id);

-- 9. Add updated_at trigger for locations table
CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
