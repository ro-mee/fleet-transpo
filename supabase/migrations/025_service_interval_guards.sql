-- ============================================
-- MIGRATION 019: Service Interval Guards + Usage-Window Index
--
-- Two follow-ups to 018, both about keeping the prediction honest under load
-- and under bad input.
--
-- 1. CHECK (> 0) on both interval columns. 018 documents that NULL and 0 mean
--    different things — NULL excludes an axis from the prediction, 0 says "due
--    every zero kilometres", which makes a vehicle due the instant it is
--    serviced and then permanently overdue with no way to work the queue down.
--    The API already enforces min: 1, but the API is not the only writer: a
--    seed script, a psql session, or a future endpoint can all reach these
--    columns, and the column is where the rule belongs. NULL still passes: a
--    CHECK is not violated by NULL, so excluding an axis remains legal.
--
-- 2. Index on trips(end_time). The usage CTE in the predictive route filters
--    `end_time > NOW() - INTERVAL '90 days'` across the whole trips table on
--    every page load. idx_trips_date covers start_time, not end_time, so that
--    predicate has no index to use and the planner falls back to a sequential
--    scan that grows with total trip history rather than with the window. The
--    index is partial on trip_status = 'Completed' AND deleted_at IS NULL —
--    the CTE always carries both predicates, and restricting the index keeps it
--    proportional to finished trips instead of every row ever inserted.
--
-- Existing values are normalized before the constraint is added, so applying
-- this to a database that already holds a 0 or a negative does not fail
-- mid-migration. Offending values become NULL rather than a guessed interval:
-- NULL is the honest "this axis does not participate", and the predictive page
-- reports such a vehicle as unscheduled rather than quietly scoring it.
--
-- Rollback: two DROP CONSTRAINT statements and one DROP INDEX.
-- ============================================

BEGIN;

-- Normalize first. A CHECK added over existing bad data aborts the whole
-- migration, and 018's columns predate the API's min: 1 rule.
UPDATE vehicles SET service_interval_km = NULL WHERE service_interval_km <= 0;
UPDATE vehicles SET service_interval_days = NULL WHERE service_interval_days <= 0;

-- ADD CONSTRAINT has no IF NOT EXISTS, so guard on the catalog to keep the
-- migration re-appliable in line with the rest of the directory.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_service_interval_km_positive'
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_service_interval_km_positive
      CHECK (service_interval_km IS NULL OR service_interval_km > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_service_interval_days_positive'
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_service_interval_days_positive
      CHECK (service_interval_days IS NULL OR service_interval_days > 0);
  END IF;
END $$;

-- Supports the usage CTE's 90-day window in
-- src/app/api/ai/predictive-maintenance/route.js.
CREATE INDEX IF NOT EXISTS idx_trips_end_time
  ON trips(end_time)
  WHERE trip_status = 'Completed' AND deleted_at IS NULL;

COMMIT;
