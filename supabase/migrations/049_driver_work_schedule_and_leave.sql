-- ============================================
-- MIGRATION 049: Driver Work Schedule + Leave Requests
--
-- Standing weekly availability for drivers, set once by the Fleet Manager at
-- driver setup, plus a leave request workflow (driver requests, Fleet Manager
-- approves/declines). Together they decide whether a driver may be assigned to
-- a given pickup window:
--
--   1. Approved leave covering the pickup date  -> blocked ("On leave")
--   2. No schedule row for that day of week      -> blocked ("No work schedule")
--   3. Row marked is_rest_day                    -> blocked ("Rest day")
--   4. Window not inside [shift_start, shift_end]-> blocked ("Outside shift")
--   5. Break overlap (half-open)                 -> blocked ("Lunch/break")
--
-- The dispatch engine reads these tables at every gate: /api/drivers,
-- /api/vehicles/available, validatePairAvailability (services/recommendation
-- .service.js), pair-scoring.js isDriverUnavailableFor/resolveVehiclePairing,
-- conflicts.js, and the trip-start guard.
--
-- Purely additive: creates two tables + indexes; alters nothing existing.
-- Rollback is two DROP TABLEs.
--
-- House convention: guarded CREATE TABLE/INDEX; bare CREATE POLICY.
-- ============================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Standing weekly work schedule (one row per driver per day of week)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_work_schedules (
  schedule_id  SERIAL PRIMARY KEY,
  driver_id    INT  NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  shift_start  TIME NOT NULL,
  shift_end    TIME NOT NULL,
  break_start  TIME,
  break_end    TIME,
  is_rest_day  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT REFERENCES employees(employee_id),
  updated_by   INT REFERENCES employees(employee_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A shift cannot end at/before it begins; a break cannot end at/before it
  -- begins; break must be both set or both null; rest days carry no times.
  CONSTRAINT chk_sched_shift CHECK (shift_end > shift_start),
  CONSTRAINT chk_sched_break CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_end > break_start)
  ),
  CONSTRAINT chk_sched_rest_day CHECK (
    NOT is_rest_day OR (shift_start = TIME '00:00' AND shift_end = TIME '00:00')
  )
);

COMMENT ON TABLE driver_work_schedules IS
  'Standing weekly work schedule per driver (one row per day of week). A row missing for a day means no schedule on file — the driver is NOT assignable that day until the Fleet Manager adds it. is_rest_day rows carry zero-time shifts as a marker.';

CREATE INDEX IF NOT EXISTS idx_dws_driver ON driver_work_schedules(driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dws_driver_day ON driver_work_schedules(driver_id, day_of_week);

-- ---------------------------------------------------------------------------
-- 2. Leave requests (driver self-service -> Fleet Manager approval)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_leave_requests (
  leave_request_id SERIAL PRIMARY KEY,
  driver_id     INT  NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  leave_type    VARCHAR(50) NOT NULL DEFAULT 'Vacation Leave',
  reason        TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'Pending'
                CHECK (status IN ('Pending', 'Approved', 'Declined')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by   INT REFERENCES employees(employee_id),
  reviewed_at   TIMESTAMPTZ,
  review_notes  TEXT,

  -- A leave cannot end before it begins.
  CONSTRAINT chk_leave_interval CHECK (end_date >= start_date)
);

COMMENT ON TABLE driver_leave_requests IS
  'Driver leave requests. Only Approved requests block dispatch on the covered dates; Pending/Declined do not.';

CREATE INDEX IF NOT EXISTS idx_leave_driver ON driver_leave_requests(driver_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_status ON driver_leave_requests(status);

-- ---------------------------------------------------------------------------
-- RLS (inert, per house convention — app-layer requireAuth is the boundary)
-- ---------------------------------------------------------------------------
ALTER TABLE driver_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view driver work schedules"
  ON driver_work_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet manager can manage driver work schedules"
  ON driver_work_schedules FOR ALL
  USING (has_role(ARRAY['system_admin', 'fleet_manager']));

CREATE POLICY "Authenticated can view driver leave requests"
  ON driver_leave_requests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet manager can manage driver leave requests"
  ON driver_leave_requests FOR ALL
  USING (has_role(ARRAY['system_admin', 'fleet_manager']));

COMMIT;