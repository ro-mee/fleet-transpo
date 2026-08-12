-- ============================================
-- MIGRATION 032: Substitute Driver Schedules
--
-- A day-scoped (or date-range / open-ended) driver who temporarily covers a
-- vehicle whose designated custodian is suspended or otherwise unavailable.
--
-- This is deliberately DISTINCT from the standing custodial pairing
-- (driver_vehicle_assignments, migration 017):
--   - driver_vehicle_assignments = who is *normally* responsible for a car.
--   - substitute_vehicle_schedules = who *temporarily* covers the car for a
--     given date / range while the custodian is out.
--
-- The recommendation engine (lib/ai/pair-scoring.js) and the dispatch guard
-- (services/recommendation.service.js validatePairAvailability,
--  lib/scheduling/conflicts.js) read these rows to resolve the vehicle's
-- "effective driver for the requested date".
--
-- A vehicle with a suspended custodian is HIDDEN from the recommended fleet
-- pair until a substitute schedule covers its pickup date. That is the fix this
-- table enables.
--
-- Purely additive: creates one table + indexes; alters nothing existing.
-- Rollback is a single DROP TABLE.
--
-- House convention: guarded CREATE TABLE/INDEX; bare CREATE POLICY.
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS substitute_vehicle_schedules (
  substitute_id       SERIAL PRIMARY KEY,
  vehicle_id          INT  NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  substitute_driver_id INT NOT NULL REFERENCES drivers(driver_id)  ON DELETE CASCADE,
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until     DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INT REFERENCES employees(employee_id),
  updated_by          INT REFERENCES employees(employee_id),

  -- A schedule cannot end before it begins. Same-day creation is legal.
  -- NULL effective_until = open-ended (a standing substitute while the
  -- custodian is out).
  CONSTRAINT chk_sub_interval
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

COMMENT ON TABLE substitute_vehicle_schedules IS
  'Temporary substitute driver coverage for a vehicle while its designated custodian is unavailable. effective_until IS NULL means open-ended.';
COMMENT ON COLUMN substitute_vehicle_schedules.effective_until IS
  'NULL = open-ended substitute coverage (until removed). Setting it bounds the coverage to a date.';

-- "Which substitute covers vehicle X on date D" is the hot lookup for the
-- recommendation engine and dispatch guard.
CREATE INDEX IF NOT EXISTS idx_sub_vehicle_range
  ON substitute_vehicle_schedules(vehicle_id, effective_from, effective_until);

-- One open-ended substitute per vehicle at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_open_vehicle
  ON substitute_vehicle_schedules(vehicle_id)
  WHERE effective_until IS NULL;

-- History / review lookup: who has covered this car across dates, newest first.
CREATE INDEX IF NOT EXISTS idx_sub_vehicle_history
  ON substitute_vehicle_schedules(vehicle_id, effective_from DESC);

-- Which cars has this driver temporarily covered.
CREATE INDEX IF NOT EXISTS idx_sub_driver
  ON substitute_vehicle_schedules(substitute_driver_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- RLS (inert, per house convention — app-layer requireAuth is the boundary)
-- ---------------------------------------------------------------------------
ALTER TABLE substitute_vehicle_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view substitute vehicle schedules"
  ON substitute_vehicle_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage substitute vehicle schedules"
  ON substitute_vehicle_schedules FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

COMMIT;