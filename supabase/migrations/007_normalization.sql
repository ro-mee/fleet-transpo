-- ============================================
-- MIGRATION 007: Schema Normalization
--
-- Purpose:
--   Normalize the schema to reduce redundancy,
--   eliminate update anomalies, and improve
--   data integrity — while keeping the schema
--   practical for real-world query patterns.
--
-- Changes:
--   1. CREATE locations reference table
--   2. RESTORE vehicledocuments from JSONB in vehicles
--   3. MERGE tripcostanalysis + tripperformance INTO trips
--   4. REMOVE duplicated route metrics from dispatchschedules + trips
--   5. REMOVE derived aggregate columns from drivers
--   6. ADD location FK references to routes, trips, reservations
--   7. UPDATE RLS policies for new tables
--   8. CREATE driver_stats view
--   9. RESTORE document expiry notification trigger
-- ============================================

-- ============================================
-- 1. CREATE locations REFERENCE TABLE
-- A single source of truth for all named locations
-- (origins, destinations, pickup/dropoff points)
-- ============================================

CREATE TABLE IF NOT EXISTS locations (
  location_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE locations IS
  'Central reference table for all named locations. Replaces inline lat/lng pairs in routes, trips, and reservations.';

-- ============================================
-- 2. RESTORE vehicledocuments FROM JSONB
-- Documents have structure (type, number, url,
-- expiry, status) that deserves a proper table.
-- The JSONB in vehicles.documents loses queryability
-- ("which vehicles have expired insurance?").
-- ============================================

CREATE TABLE IF NOT EXISTS vehicledocuments (
  document_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_number VARCHAR(255),
  file_url TEXT NOT NULL,
  expiry_date DATE,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicledocuments_vehicle ON vehicledocuments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicledocuments_type ON vehicledocuments(document_type);
CREATE INDEX IF NOT EXISTS idx_vehicledocuments_expiry ON vehicledocuments(expiry_date);

COMMENT ON TABLE vehicledocuments IS
  'Restored relational table for vehicle documents. Each row is one document (insurance, registration, etc.).';

-- Migrate existing data from vehicles.documents JSONB
INSERT INTO vehicledocuments (vehicle_id, document_type, document_number, file_url, expiry_date, status)
SELECT
  v.vehicle_id,
  doc->>'document_type',
  doc->>'document_number',
  doc->>'file_url',
  (doc->>'expiry_date')::DATE,
  COALESCE(doc->>'status', 'Active')
FROM vehicles v
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.documents, '[]'::jsonb)) AS doc
WHERE v.documents IS NOT NULL AND v.documents != '[]'::jsonb;

-- Drop the JSONB column from vehicles after migration
ALTER TABLE vehicles DROP COLUMN IF EXISTS documents;

-- ============================================
-- 3. MERGE tripcostanalysis INTO trips
-- Every trip has exactly one cost analysis record.
-- No reason to keep a separate 1:1 table.
-- Derived fields (total_cost, cost_per_km) kept as
-- nullable — app can compute via trigger or view.
-- ============================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS fuel_cost DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_fees DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parking_fees DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_cost DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maintenance_cost DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS miscellaneous_cost DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost DECIMAL(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_km DECIMAL(8, 2);

-- Migrate cost data
UPDATE trips t
SET
  fuel_cost = COALESCE(tca.fuel_cost, 0),
  toll_fees = COALESCE(tca.toll_fees, 0),
  parking_fees = COALESCE(tca.parking_fees, 0),
  driver_cost = COALESCE(tca.driver_cost, 0),
  maintenance_cost = COALESCE(tca.maintenance_cost, 0),
  miscellaneous_cost = COALESCE(tca.miscellaneous_cost, 0),
  total_cost = COALESCE(tca.total_cost, 0),
  cost_per_km = tca.cost_per_km
FROM tripcostanalysis tca
WHERE tca.trip_id = t.trip_id;

-- ============================================
-- 3b. MERGE tripperformance INTO trips
-- Same pattern — every trip has exactly one
-- performance record. Skip fields already in trips
-- (avg_speed, max_speed, idle_time, driver_id).
-- ============================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS on_time_completion BOOLEAN,
  ADD COLUMN IF NOT EXISTS time_variance INT,
  ADD COLUMN IF NOT EXISTS fuel_efficiency DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS smooth_driving_score DECIMAL(3, 2),
  ADD COLUMN IF NOT EXISTS customer_rating DECIMAL(2, 1),
  ADD COLUMN IF NOT EXISTS performance_notes TEXT;

-- Migrate performance data
UPDATE trips t
SET
  on_time_completion = tp.on_time_completion,
  time_variance = tp.time_variance,
  fuel_efficiency = tp.fuel_efficiency,
  smooth_driving_score = tp.smooth_driving_score,
  customer_rating = tp.customer_rating,
  performance_notes = tp.notes
FROM tripperformance tp
WHERE tp.trip_id = t.trip_id;

-- Add index on new performance columns
CREATE INDEX IF NOT EXISTS idx_trips_rating ON trips(customer_rating);
CREATE INDEX IF NOT EXISTS idx_trips_on_time ON trips(on_time_completion);

-- ============================================
-- 4. REMOVE duplicated route metrics
-- estimated_distance and estimated_duration are
-- properties of routes, not of dispatches or trips.
-- They should be joined from routes when needed.
-- ============================================

ALTER TABLE dispatchschedules
  DROP COLUMN IF EXISTS estimated_distance,
  DROP COLUMN IF EXISTS estimated_duration;

ALTER TABLE trips
  DROP COLUMN IF EXISTS estimated_distance,
  DROP COLUMN IF EXISTS estimated_duration;

-- Also remove duplicated origin/destination from trips
-- (these come from the route or reservation)
ALTER TABLE trips
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS destination;

-- ============================================
-- 5. REMOVE license columns FROM employees
-- License info is driver-specific and already
-- exists in the drivers table. Keeping it on
-- employees creates a sync risk (what if they
-- diverge?) and violates the principle of one
-- source of truth.
-- ============================================

ALTER TABLE employees
  DROP COLUMN IF EXISTS license_number,
  DROP COLUMN IF EXISTS license_expiry;

-- ============================================
-- 5b. REMOVE derived aggregate columns FROM drivers
-- performance_score, total_trips, total_distance,
-- total_hours, and rating are all derivable from
-- trips + tripperformance data.
--
-- Rationale: The service layer already treats these
-- as computed (driver.service.js strips them from
-- writes and reads from driver_stats view).
-- Keeping them on the table creates a sync burden
-- with no benefit.
-- ============================================

ALTER TABLE drivers
  DROP COLUMN IF EXISTS performance_score,
  DROP COLUMN IF EXISTS total_trips,
  DROP COLUMN IF EXISTS total_distance,
  DROP COLUMN IF EXISTS total_hours,
  DROP COLUMN IF EXISTS rating;

-- ============================================
-- 5c. DROP old 1:1 tables (after data migration)
-- Drop policies first to avoid "relation does not exist"
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view trip cost analysis" ON tripcostanalysis;
DROP POLICY IF EXISTS "Admin can manage trip cost analysis" ON tripcostanalysis;
DROP POLICY IF EXISTS "Authenticated can view trip performance" ON tripperformance;
DROP POLICY IF EXISTS "Admin can manage trip performance" ON tripperformance;

DROP TABLE IF EXISTS tripcostanalysis CASCADE;
DROP TABLE IF EXISTS tripperformance CASCADE;

-- ============================================
-- 6. ADD location FK REFERENCES
-- Replace inline lat/lng pairs with FK references
-- to the locations table.
-- ============================================

-- Migration strategy: extract unique location
-- names+coords from existing data, insert into
-- locations, then set the FK columns.

-- Helper: migrate a set of location values into the locations table
-- and return the location_id. Called per-table below.

-- 6a. Routes: origin and destination
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS origin_location_id INT REFERENCES locations(location_id),
  ADD COLUMN IF NOT EXISTS destination_location_id INT REFERENCES locations(location_id);

-- Extract unique origin locations from routes
WITH origin_locations AS (
  SELECT DISTINCT
    origin AS name,
    origin_latitude AS latitude,
    origin_longitude AS longitude
  FROM routes
  WHERE origin IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.name = routes.origin
        AND (l.latitude IS NOT DISTINCT FROM routes.origin_latitude)
        AND (l.longitude IS NOT DISTINCT FROM routes.origin_longitude)
    )
)
INSERT INTO locations (name, latitude, longitude)
SELECT name, latitude, longitude FROM origin_locations
;

-- Extract unique destination locations from routes
WITH destination_locations AS (
  SELECT DISTINCT
    destination AS name,
    destination_latitude AS latitude,
    destination_longitude AS longitude
  FROM routes
  WHERE destination IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.name = routes.destination
        AND (l.latitude IS NOT DISTINCT FROM routes.destination_latitude)
        AND (l.longitude IS NOT DISTINCT FROM routes.destination_longitude)
    )
)
INSERT INTO locations (name, latitude, longitude)
SELECT name, latitude, longitude FROM destination_locations;

-- Set origin_location_id
UPDATE routes r
SET origin_location_id = l.location_id
FROM locations l
WHERE l.name = r.origin
  AND (l.latitude IS NOT DISTINCT FROM r.origin_latitude)
  AND (l.longitude IS NOT DISTINCT FROM r.origin_longitude);

-- Set destination_location_id
UPDATE routes r
SET destination_location_id = l.location_id
FROM locations l
WHERE l.name = r.destination
  AND (l.latitude IS NOT DISTINCT FROM r.destination_latitude)
  AND (l.longitude IS NOT DISTINCT FROM r.destination_longitude);

-- 6b. Vehiclereservations: pickup and dropoff
ALTER TABLE vehiclereservations
  ADD COLUMN IF NOT EXISTS pickup_location_id INT REFERENCES locations(location_id),
  ADD COLUMN IF NOT EXISTS dropoff_location_id INT REFERENCES locations(location_id);

-- Extract unique pickup locations from reservations
WITH pickup_locations AS (
  SELECT DISTINCT
    pickup_location AS name,
    pickup_latitude AS latitude,
    pickup_longitude AS longitude
  FROM vehiclereservations
  WHERE pickup_location IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.name = vehiclereservations.pickup_location
        AND (l.latitude IS NOT DISTINCT FROM vehiclereservations.pickup_latitude)
        AND (l.longitude IS NOT DISTINCT FROM vehiclereservations.pickup_longitude)
    )
)
INSERT INTO locations (name, latitude, longitude)
SELECT name, latitude, longitude FROM pickup_locations;

-- Extract unique dropoff locations from reservations
WITH dropoff_locations AS (
  SELECT DISTINCT
    dropoff_location AS name,
    dropoff_latitude AS latitude,
    dropoff_longitude AS longitude
  FROM vehiclereservations
  WHERE dropoff_location IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.name = vehiclereservations.dropoff_location
        AND (l.latitude IS NOT DISTINCT FROM vehiclereservations.dropoff_latitude)
        AND (l.longitude IS NOT DISTINCT FROM vehiclereservations.dropoff_longitude)
    )
)
INSERT INTO locations (name, latitude, longitude)
SELECT name, latitude, longitude FROM dropoff_locations;

-- Set pickup_location_id
UPDATE vehiclereservations vr
SET pickup_location_id = l.location_id
FROM locations l
WHERE l.name = vr.pickup_location
  AND (l.latitude IS NOT DISTINCT FROM vr.pickup_latitude)
  AND (l.longitude IS NOT DISTINCT FROM vr.pickup_longitude);

-- Set dropoff_location_id
UPDATE vehiclereservations vr
SET dropoff_location_id = l.location_id
FROM locations l
WHERE l.name = vr.dropoff_location
  AND (l.latitude IS NOT DISTINCT FROM vr.dropoff_latitude)
  AND (l.longitude IS NOT DISTINCT FROM vr.dropoff_longitude);

-- Drop old inline location columns (keep text names for display/backward compat)
ALTER TABLE routes
  DROP COLUMN IF EXISTS origin_latitude,
  DROP COLUMN IF EXISTS origin_longitude,
  DROP COLUMN IF EXISTS destination_latitude,
  DROP COLUMN IF EXISTS destination_longitude;

ALTER TABLE vehiclereservations
  DROP COLUMN IF EXISTS pickup_latitude,
  DROP COLUMN IF EXISTS pickup_longitude,
  DROP COLUMN IF EXISTS dropoff_latitude,
  DROP COLUMN IF EXISTS dropoff_longitude;

-- ============================================
-- 7. CREATE driver_stats VIEW
-- Replaces the derived aggregate columns that were
-- dropped from the drivers table. Computes totals
-- from trips (and merged performance data).
-- ============================================

CREATE OR REPLACE VIEW driver_stats AS
SELECT
  d.driver_id,
  COUNT(DISTINCT t.trip_id) AS total_trips,
  COALESCE(SUM(t.distance), 0) AS total_distance,
  COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(t.end_time, NOW()) - t.start_time)) / 3600), 0) AS total_hours,
  COALESCE(AVG(t.customer_rating), 0) AS rating,
  COALESCE(AVG(t.smooth_driving_score), 0) AS performance_score
FROM drivers d
LEFT JOIN trips t ON d.driver_id = t.driver_id AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
GROUP BY d.driver_id;

COMMENT ON VIEW driver_stats IS
  'Computed driver aggregates from completed trips. Replaces the old derived columns on the drivers table.';

-- ============================================
-- 8. UPDATE RLS POLICIES
-- ============================================

-- Locations
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view locations"
  ON locations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage locations"
  ON locations FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- Vehicledocuments (restored)
ALTER TABLE vehicledocuments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view vehicle documents"
  ON vehicledocuments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can manage vehicle documents"
  ON vehicledocuments FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- 9. RESTORE document expiry notification trigger
-- Re-creates the trigger that was dropped in
-- migration 005 when vehicledocuments was removed.
-- ============================================

CREATE OR REPLACE FUNCTION notify_document_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND NEW.expiry_date > CURRENT_DATE THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Document Expiring Soon',
      NEW.document_type || ' for vehicle #' || NEW.vehicle_id || ' expires on ' || NEW.expiry_date,
      'Warning',
      'document',
      NEW.document_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_document_expiry ON vehicledocuments;

CREATE TRIGGER trigger_notify_document_expiry
  AFTER INSERT OR UPDATE ON vehicledocuments
  FOR EACH ROW
  EXECUTE FUNCTION notify_document_expiry();

-- ============================================
-- 10. ADD INDEXES FOR NEW COLUMNS
-- Based on query patterns from service files
-- ============================================

CREATE INDEX IF NOT EXISTS idx_routes_origin_loc ON routes(origin_location_id);
CREATE INDEX IF NOT EXISTS idx_routes_dest_loc ON routes(destination_location_id);
CREATE INDEX IF NOT EXISTS idx_reservations_pickup_loc ON vehiclereservations(pickup_location_id);
CREATE INDEX IF NOT EXISTS idx_reservations_dropoff_loc ON vehiclereservations(dropoff_location_id);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);
CREATE INDEX IF NOT EXISTS idx_drivers_face ON drivers(face_image_url);
