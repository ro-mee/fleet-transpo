-- ============================================
-- MIGRATION 007: Remove Derived / Aggregate Columns
--
-- Purpose:
--   Remove aggregate columns from drivers that
--   are computed from other tables (trips,
--   tripperformance) and replace with a computed
--   view. Also add triggers for same-table
--   derived columns in tripcostanalysis.
--
-- Changes:
--   1. Drop aggregate columns from drivers:
--      total_trips, total_distance, total_hours,
--      performance_score, rating
--   2. Create driver_stats VIEW that computes
--      them from trips + tripperformance
--   3. Create vehicle_trip_stats VIEW for
--      vehicle-side aggregates from trips
--   4. Add trigger on tripcostanalysis to
--      auto-compute total_cost and cost_per_km
-- ============================================

-- ============================================
-- 1. DROP AGGREGATE COLUMNS FROM drivers
-- ============================================

ALTER TABLE drivers
  DROP COLUMN IF EXISTS total_trips CASCADE,
  DROP COLUMN IF EXISTS total_distance CASCADE,
  DROP COLUMN IF EXISTS total_hours CASCADE,
  DROP COLUMN IF EXISTS performance_score CASCADE,
  DROP COLUMN IF EXISTS rating CASCADE;

-- ============================================
-- 2. CREATE driver_stats VIEW
--
-- Computes driver aggregate metrics from
-- trips and tripperformance.
-- Excludes soft-deleted trips.
-- Returns one row per driver.
-- ============================================

CREATE OR REPLACE VIEW driver_stats AS
SELECT
  d.driver_id,
  d.employee_id,
  COUNT(DISTINCT t.trip_id)::INT AS total_trips,
  COALESCE(SUM(t.distance), 0) AS total_distance,
  ROUND(COALESCE(SUM(t.actual_duration), 0) / 60.0, 2) AS total_hours,
  ROUND(COALESCE(AVG(tp.smooth_driving_score), 0), 2) AS performance_score,
  ROUND(COALESCE(AVG(tp.customer_rating), 0), 1) AS rating
FROM drivers d
LEFT JOIN trips t ON d.driver_id = t.driver_id AND t.deleted_at IS NULL
LEFT JOIN tripperformance tp ON t.trip_id = tp.trip_id
WHERE d.deleted_at IS NULL
GROUP BY d.driver_id, d.employee_id;

COMMENT ON VIEW driver_stats IS
  'Real-time computed aggregate metrics per driver from trips and tripperformance. Replaces the dropped pre-computed columns on the drivers table.';

-- ============================================
-- 3. CREATE vehicle_trip_stats VIEW
--
-- Vehicle-side trip aggregates (similar
-- derived columns pattern found on vehicles).
-- ============================================

CREATE OR REPLACE VIEW vehicle_trip_stats AS
SELECT
  v.vehicle_id,
  COUNT(DISTINCT t.trip_id)::INT AS total_trips,
  COALESCE(SUM(t.distance), 0) AS total_distance,
  ROUND(COALESCE(SUM(t.actual_duration), 0) / 60.0, 2) AS total_hours,
  COALESCE(SUM(t.fuel_consumed), 0) AS total_fuel_consumed,
  ROUND(AVG(t.avg_speed), 2) AS avg_speed,
  MAX(t.max_speed) AS max_speed
FROM vehicles v
LEFT JOIN trips t ON v.vehicle_id = t.vehicle_id AND t.deleted_at IS NULL
WHERE v.deleted_at IS NULL
GROUP BY v.vehicle_id;

COMMENT ON VIEW vehicle_trip_stats IS
  'Real-time computed trip aggregate metrics per vehicle from the trips table.';

-- ============================================
-- 4. TRIGGER: Auto-compute derived columns
--    on tripcostanalysis
--
-- total_cost = sum of all cost components
-- cost_per_km = total_cost / trip.distance
-- ============================================

CREATE OR REPLACE FUNCTION compute_trip_cost()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_cost := COALESCE(NEW.fuel_cost, 0)
                  + COALESCE(NEW.toll_fees, 0)
                  + COALESCE(NEW.parking_fees, 0)
                  + COALESCE(NEW.driver_cost, 0)
                  + COALESCE(NEW.maintenance_cost, 0)
                  + COALESCE(NEW.miscellaneous_cost, 0);

  NEW.cost_per_km := CASE
    WHEN NEW.trip_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM trips WHERE trip_id = NEW.trip_id AND COALESCE(distance, 0) > 0)
    THEN ROUND(NEW.total_cost / (SELECT distance FROM trips WHERE trip_id = NEW.trip_id), 2)
    ELSE NULL
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_compute_trip_cost
  BEFORE INSERT OR UPDATE
  ON tripcostanalysis
  FOR EACH ROW
  EXECUTE FUNCTION compute_trip_cost();

COMMENT ON FUNCTION compute_trip_cost IS
  'Automatically computes total_cost (sum of components) and cost_per_km (total_cost / trip.distance) before INSERT or UPDATE on tripcostanalysis.';

-- ============================================
-- 5. HELPER VIEW: driver_details
--
-- Convenience view that joins drivers,
-- employees, and driver_stats for easy
-- querying. Replaces the common pattern of
-- "select *, employees(*) from drivers"
-- with aggregates included.
-- ============================================

CREATE OR REPLACE VIEW driver_details AS
SELECT
  d.*,
  e.first_name,
  e.last_name,
  e.email,
  e.phone AS employee_phone,
  e.position,
  e.status AS employee_status,
  e.avatar_url,
  e.user_id,
  e.branch_id AS employee_branch_id,
  ds.total_trips,
  ds.total_distance,
  ds.total_hours,
  ds.performance_score,
  ds.rating
FROM drivers d
JOIN employees e ON d.employee_id = e.employee_id
LEFT JOIN driver_stats ds ON d.driver_id = ds.driver_id;

COMMENT ON VIEW driver_details IS
  'Convenience view joining drivers, employees, and driver_stats. One row per driver with denormalized employee info and computed aggregate metrics.';
