-- ============================================
-- MIGRATION 016: Reservation Module Enhancement
--
-- Unifies Fleet's reservation vocabulary into a strict 9-status linear chain,
-- adds enriched columns for the dispatcher workspace (reservation_number,
-- distance/duration, vehicle type, assignments, AI cache), and introduces a
-- timestamped event log for the timeline feature.
--
-- House convention: guarded CREATE TABLE/INDEX/COLUMN; bare ADD CONSTRAINT/
-- CREATE TRIGGER/CREATE POLICY (fresh-apply-once, same as 015).
-- ============================================

BEGIN;

-- ============================================
-- 1. RETIRE THE 015 TEN-STATUS VOCABULARY
-- ============================================

-- Drop the existing CHECK so we can alter data. The back-fill below moves rows
-- out of the retired statuses before re-adding the constraint with the new set.
ALTER TABLE transportation_requests DROP CONSTRAINT IF EXISTS chk_transport_fleet_status;

-- Back-fill: 'Waiting for Fleet Review' -> 'Pending', assignment split -> 'Assigned'
UPDATE transportation_requests
SET fleet_status = CASE fleet_status
  WHEN 'Waiting for Fleet Review' THEN 'Pending'
  WHEN 'Driver Assigned' THEN 'Assigned'
  WHEN 'Vehicle Assigned' THEN 'Assigned'
  ELSE fleet_status
END
WHERE fleet_status IN ('Waiting for Fleet Review', 'Driver Assigned', 'Vehicle Assigned');

-- Change the column default from 'Waiting for Fleet Review' to 'Pending'.
ALTER TABLE transportation_requests ALTER COLUMN fleet_status SET DEFAULT 'Pending';

-- Re-add the CHECK with the 9-status vocabulary. Strict linear chain:
-- Pending → Under Review → Approved|Rejected → Scheduled → Assigned →
-- In Progress → Completed. Cancelled reachable from any non-terminal.
ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_fleet_status
  CHECK (fleet_status IN (
    'Pending',
    'Under Review',
    'Approved',
    'Rejected',
    'Scheduled',
    'Assigned',
    'In Progress',
    'Completed',
    'Cancelled'
  ));

-- ============================================
-- 2. PRIORITY NORMALIZATION
-- ============================================

-- Back-fill 'Normal' → 'Medium' (Booking sends Normal; Fleet uses Medium).
UPDATE transportation_requests SET priority = 'Medium' WHERE priority = 'Normal';

-- Add CHECK: only the 4-priority vocabulary (no 'Normal').
ALTER TABLE transportation_requests DROP CONSTRAINT IF EXISTS chk_transport_priority;
ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_priority
  CHECK (priority IN ('Urgent', 'High', 'Medium', 'Low'));

-- ============================================
-- 3. NEW COLUMNS ON transportation_requests
-- ============================================

-- Reservation number: RSV-YYYYMMDD-####, back-filled below
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS reservation_number VARCHAR(30) UNIQUE;

-- Requested vehicle type: raw string from Booking (read-only cache)
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS requested_vehicle_type VARCHAR(100);

-- Resolved category FK
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS requested_category_id INT REFERENCES vehiclecategories(category_id);

-- Distance/duration: computed on ingest, cached for sorting/filtering
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS estimated_distance DECIMAL(10, 2);
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS estimated_duration INT;

-- Fleet-owned assignments (vehicle + driver)
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS vehicle_id INT REFERENCES vehicles(vehicle_id);
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS driver_id INT REFERENCES drivers(driver_id);

-- AI recommendation cache (deterministic rule-engine output, optional LLM narration)
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS ai_vehicle_recommendation JSONB;
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS ai_driver_recommendation JSONB;

-- Approval audit trail
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES employees(employee_id);
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES employees(employee_id);
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Indexes on new searchable/filterable columns
CREATE INDEX IF NOT EXISTS idx_transport_requests_reservation_number
  ON transportation_requests(reservation_number);
CREATE INDEX IF NOT EXISTS idx_transport_requests_vehicle
  ON transportation_requests(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_driver
  ON transportation_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_category
  ON transportation_requests(requested_category_id);

-- ============================================
-- 4. BACK-FILL RESERVATION NUMBERS
-- ============================================

-- Generate RSV-YYYYMMDD-#### for existing rows. Scoped per day to keep numbers
-- short and collision-safe on the UNIQUE index. Rows created on the same day
-- get sequential numbers starting from 0001.
WITH numbered AS (
  SELECT
    request_id,
    'RSV-' ||
    TO_CHAR(created_at, 'YYYYMMDD') ||
    '-' ||
    LPAD(ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY request_id)::TEXT, 4, '0')
    AS new_number
  FROM transportation_requests
  WHERE reservation_number IS NULL
)
UPDATE transportation_requests tr
SET reservation_number = numbered.new_number
FROM numbered
WHERE tr.request_id = numbered.request_id;

-- ============================================
-- 5. CREATE reservation_events TABLE
-- ============================================

-- Append-only timeline for the Phase 15 feature. Every status transition,
-- assignment, approval, rejection, and cancellation writes one row here.
CREATE TABLE IF NOT EXISTS reservation_events (
  event_id          BIGSERIAL PRIMARY KEY,
  request_id        INT NOT NULL REFERENCES transportation_requests(request_id) ON DELETE CASCADE,
  event_type        VARCHAR(50) NOT NULL,
  from_status       VARCHAR(50),
  to_status         VARCHAR(50),
  actor_id          INT REFERENCES employees(employee_id),
  actor_role        VARCHAR(50),
  description       TEXT,
  metadata          JSONB,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient timeline query: ORDER BY (request_id, occurred_at DESC)
CREATE INDEX IF NOT EXISTS idx_reservation_events_request_timeline
  ON reservation_events(request_id, occurred_at DESC);

-- ============================================
-- 6. RLS + POLICIES (inert, per convention)
-- ============================================

-- RLS is enabled but never enforced — app-layer authz via requireAuth(req,[roles])
-- is the real boundary (see memory [[security-model-decisions]]). These policies
-- mirror the 015 pattern so the table matches the posture of its parent.
ALTER TABLE reservation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view reservation events"
  ON reservation_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage reservation events"
  ON reservation_events FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher']));

COMMIT;
