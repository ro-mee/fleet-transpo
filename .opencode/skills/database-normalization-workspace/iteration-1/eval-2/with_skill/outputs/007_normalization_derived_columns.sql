-- ============================================
-- MIGRATION 007: Remove Derived/Aggregate Columns
--
-- Purpose:
--   Remove columns that can be computed from
--   other tables and replace them with views
--   and generated columns.
--
-- Changes:
--   1. Create driver_stats VIEW (computes
--      performance_score, total_trips,
--      total_distance, total_hours, rating
--      from trips and tripperformance)
--   2. Convert tripcostanalysis.total_cost
--      to a generated column (computed from
--      individual cost columns in same table)
--   3. Create trip_cost_details VIEW (includes
--      cost_per_km computed with join to trips)
--   4. Drop derived columns from drivers table
--   5. Update seed data
--
-- Rationale:
--   - Drivers aggregates: Removed in favor of a
--     view because they were never written by
--     application code, only read. No trigger
--     kept them in sync, so they could drift.
--     A view guarantees consistency at read time.
--   - tripcostanalysis.total_cost: Converted to
--     a generated column because it depends only
--     on other columns in the same table.
--   - tripcostanalysis.cost_per_km: Moved to a
--     view because it requires a join to trips
--     for the distance value.
-- ============================================

-- ============================================
-- 1. CREATE driver_stats VIEW
-- Computes driver aggregate metrics from trips
-- and tripperformance data.
-- ============================================

CREATE OR REPLACE VIEW driver_stats AS
WITH driver_trip_aggregates AS (
  SELECT
    t.driver_id,
    COUNT(t.trip_id) FILTER (WHERE t.trip_status = 'Completed') AS total_trips,
    COALESCE(SUM(t.distance) FILTER (WHERE t.trip_status = 'Completed'), 0) AS total_distance,
    COALESCE(SUM(t.actual_duration) FILTER (WHERE t.trip_status = 'Completed'), 0) AS total_duration_minutes
  FROM trips t
  WHERE t.deleted_at IS NULL
  GROUP BY t.driver_id
),
driver_performance_aggregates AS (
  SELECT
    tp.driver_id,
    ROUND(AVG(tp.smooth_driving_score)::numeric, 2) AS avg_smooth_driving_score,
    ROUND(AVG(tp.customer_rating)::numeric, 1) AS avg_customer_rating
  FROM tripperformance tp
  GROUP BY tp.driver_id
)
SELECT
  d.driver_id,
  COALESCE(pta.total_trips, 0) AS total_trips,
  COALESCE(pta.total_distance, 0) AS total_distance,
  ROUND((COALESCE(pta.total_duration_minutes, 0) / 60.0)::numeric, 2) AS total_hours,
  ROUND(
    (
      COALESCE(dpa.avg_smooth_driving_score, 0) * 0.6
      + COALESCE(dpa.avg_customer_rating, 0) * 0.4
    )::numeric,
    2
  ) AS performance_score,
  COALESCE(dpa.avg_customer_rating, 0) AS rating
FROM drivers d
LEFT JOIN driver_trip_aggregates pta ON d.driver_id = pta.driver_id
LEFT JOIN driver_performance_aggregates dpa ON d.driver_id = dpa.driver_id;

COMMENT ON VIEW driver_stats IS
  'Driver aggregate metrics computed from trips and tripperformance data.
   performance_score = weighted avg of smooth_driving_score (60%) and customer_rating (40%).
   total_hours = actual_duration in minutes / 60.';

-- ============================================
-- 2. CONVERT tripcostanalysis.total_cost TO
--    a generated column
-- ============================================

-- Drop the existing column that was manually stored
ALTER TABLE tripcostanalysis DROP COLUMN IF EXISTS total_cost;

-- Re-add it as a generated column
ALTER TABLE tripcostanalysis
  ADD COLUMN total_cost DECIMAL(14, 2)
  GENERATED ALWAYS AS (
    COALESCE(fuel_cost, 0)
    + COALESCE(toll_fees, 0)
    + COALESCE(parking_fees, 0)
    + COALESCE(driver_cost, 0)
    + COALESCE(maintenance_cost, 0)
    + COALESCE(miscellaneous_cost, 0)
  ) STORED;

COMMENT ON COLUMN tripcostanalysis.total_cost IS
  'Generated column: sum of all individual cost columns.';

-- Drop cost_per_km since it is now computed in trip_cost_details view
ALTER TABLE tripcostanalysis DROP COLUMN IF EXISTS cost_per_km;

-- ============================================
-- 3. CREATE trip_cost_details VIEW
-- Includes cost_per_km (needs join to trips
-- for distance, so cannot be a generated
-- column in tripcostanalysis alone).
-- ============================================

CREATE OR REPLACE VIEW trip_cost_details AS
SELECT
  tca.cost_id,
  tca.trip_id,
  tca.fuel_cost,
  tca.toll_fees,
  tca.parking_fees,
  tca.driver_cost,
  tca.maintenance_cost,
  tca.miscellaneous_cost,
  tca.total_cost,
  CASE
    WHEN t.distance IS NOT NULL AND t.distance > 0
    THEN ROUND((tca.total_cost / t.distance)::numeric, 2)
    ELSE NULL
  END AS cost_per_km,
  t.distance AS trip_distance,
  t.created_at
FROM tripcostanalysis tca
JOIN trips t ON tca.trip_id = t.trip_id;

COMMENT ON VIEW trip_cost_details IS
  'Trip cost analysis with computed cost_per_km (total_cost / trip distance).';

-- ============================================
-- 4. DROP derived columns from drivers table
-- ============================================

ALTER TABLE drivers
  DROP COLUMN IF EXISTS performance_score CASCADE,
  DROP COLUMN IF EXISTS total_trips CASCADE,
  DROP COLUMN IF EXISTS total_distance CASCADE,
  DROP COLUMN IF EXISTS total_hours CASCADE,
  DROP COLUMN IF EXISTS rating CASCADE;

-- ============================================
-- 5. RE-ENABLE RLS ON NEW VIEWS
-- (Views inherit permissions from underlying
--  tables when accessed via SECURITY INVOKER,
--  which is the default. Explicit policies are
--  only needed if you want to restrict access
--  further.)
-- ============================================
-- The driver_stats and trip_cost_details views
-- use SECURITY INVOKER by default, so they will
-- respect the RLS policies of the underlying
-- drivers, trips, tripperformance, and
-- tripcostanalysis tables.
-- No additional policies needed.
