-- ============================================
-- MIGRATION 017: Permanent Driver ↔ Vehicle Pairing
--
-- Records which vehicle a driver is *normally* responsible for — the custodial
-- pairing behind fuel, cleanliness, and damage accountability. This is NOT a
-- double-booking guard: overlapping-window conflicts are already caught by
-- evaluateRequestConflicts (src/lib/scheduling/conflicts.js) and enforced by
-- /api/dispatch with a 409. A departure from the pairing is a WARNING, never a
-- block, because a driver whose paired car is in maintenance must still be able
-- to take another one.
--
-- Modelled as an interval history rather than a column on `drivers`:
-- reassignment is routine, and closing an interval preserves who held the car
-- when. Releasing IS setting assigned_until — there is deliberately no
-- deleted_at, which would fight the partial unique indexes below and create two
-- ways to express one state.
--
-- Purely additive: creates one table and its indexes; alters nothing existing.
-- Rollback is a single DROP TABLE.
--
-- House convention: guarded CREATE TABLE/INDEX; bare CREATE POLICY
-- (fresh-apply-once, same as 015/016).
-- ============================================

BEGIN;

-- ============================================
-- 1. CREATE driver_vehicle_assignments TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  assignment_id     SERIAL PRIMARY KEY,
  driver_id         INT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  vehicle_id        INT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  assigned_from     DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_until    DATE,
  release_reason    VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        INT REFERENCES employees(employee_id),
  updated_by        INT REFERENCES employees(employee_id),

  -- A pairing cannot end before it began. Same-day assign-and-release is legal.
  CONSTRAINT chk_dva_interval
    CHECK (assigned_until IS NULL OR assigned_until >= assigned_from)
);

COMMENT ON TABLE driver_vehicle_assignments IS
  'Custodial history: which vehicle each driver is normally responsible for. assigned_until IS NULL means the pairing is active.';
COMMENT ON COLUMN driver_vehicle_assignments.assigned_until IS
  'NULL = currently active. Setting this releases the pairing; rows are never deleted.';

-- ============================================
-- 2. ACTIVE-PAIRING ENFORCEMENT (the real guard)
-- ============================================

-- Unlike every other conflict rule in this codebase — which are app-layer
-- check-then-insert with an acknowledged TOCTOU race — these are enforced by
-- Postgres itself. The WHERE clause scopes each index to live rows only, so
-- closed intervals accumulate freely as history.
--
-- One driver may hold at most one vehicle at a time...
CREATE UNIQUE INDEX IF NOT EXISTS uq_dva_active_driver
  ON driver_vehicle_assignments(driver_id)
  WHERE assigned_until IS NULL;

-- ...and one vehicle may have at most one custodian at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dva_active_vehicle
  ON driver_vehicle_assignments(vehicle_id)
  WHERE assigned_until IS NULL;

-- ============================================
-- 3. HISTORY LOOKUP INDEXES
-- ============================================

-- "Which cars has this driver held?" / "Who has held this car?", newest first.
CREATE INDEX IF NOT EXISTS idx_dva_driver_history
  ON driver_vehicle_assignments(driver_id, assigned_from DESC);

CREATE INDEX IF NOT EXISTS idx_dva_vehicle_history
  ON driver_vehicle_assignments(vehicle_id, assigned_from DESC);

-- ============================================
-- 4. RLS + POLICIES (inert, per convention)
-- ============================================

-- RLS is enabled but never enforced — app-layer authz via requireAuth(req,[roles])
-- is the real boundary (see docs/rbac-model.md). These policies mirror the
-- 015/016 pattern so the table matches the posture of its neighbours.
ALTER TABLE driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view driver vehicle assignments"
  ON driver_vehicle_assignments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage driver vehicle assignments"
  ON driver_vehicle_assignments FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher']));

-- No back-fill: there is no existing data a pairing can be derived from, and
-- guessing one from trip history would invent custodial facts nobody asserted.
-- The table starts empty; admins assign deliberately.

COMMIT;
