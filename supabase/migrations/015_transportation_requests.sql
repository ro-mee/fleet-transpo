-- ============================================
-- MIGRATION 015: Transportation Requests (Booking Integration)
--
-- Purpose:
--   Make Fleet a proper SUB-SYSTEM of the parent Booking/Hotel system.
--   The Booking subsystem OWNS reservations (guest, booking, pickup details)
--   and OWNS approval. Fleet only RECEIVES transportation requests, reviews
--   them, and dispatches. Fleet must never create hotel reservations.
--
--   This migration is ADDITIVE and non-destructive:
--     1. New `transportation_requests` table = the Fleet Reservation Queue.
--        It is a Fleet-side CACHE of what Booking sent (denormalized snapshot),
--        plus Fleet's own lifecycle status.
--     2. Link `vehiclereservations` (now the Fleet ASSIGNMENT record) back to
--        its originating request via `request_id`.
--     3. Mark the guest-PII columns on vehiclereservations as DEPRECATED —
--        those are mastered by Booking. A future migration will drop them once
--        all reads go through transportation_requests. Nothing is dropped now.
--
--   Single-org decision honored: there is NO branch column anywhere here.
--   (Branches were removed in migration 013 and are not being reintroduced.)
--
--   NOTE ON RLS: This project enforces authorization at the APPLICATION layer
--   (requireAuth in API routes). Both DB access paths (pg Pool as owner, and
--   the Supabase service-role client) bypass RLS, so any RLS below is INERT and
--   is NOT the security boundary. See docs/rbac-model.md §5.
-- ============================================

-- ============================================
-- 1. TRANSPORTATION REQUESTS (Fleet Reservation Queue)
--
-- One row per transportation request received FROM the Booking subsystem.
-- `external_booking_id` is the idempotency key: re-delivering the same booking
-- (retried webhook, replayed event) must NOT create a duplicate.
-- ============================================

CREATE TABLE IF NOT EXISTS transportation_requests (
  request_id            SERIAL PRIMARY KEY,

  -- Idempotency + provenance (from Booking)
  external_booking_id   VARCHAR(255) UNIQUE,
  source_system         VARCHAR(50)  NOT NULL DEFAULT 'PMS',
  booking_reference     VARCHAR(100),

  -- Denormalized snapshot of Booking-owned data. Fleet caches these read-only
  -- for display/dispatch; Booking remains the system of record.
  guest_name            VARCHAR(255),
  pickup_location       TEXT         NOT NULL,
  dropoff_location      TEXT,
  pickup_datetime       TIMESTAMPTZ  NOT NULL,
  passenger_count       INT          NOT NULL DEFAULT 1,
  special_requests      TEXT,
  service_type_id       INT REFERENCES service_types(service_type_id),

  -- Priority for the queue (Fleet may raise/lower; defaults from Booking).
  priority              VARCHAR(20)  NOT NULL DEFAULT 'Normal',

  -- Status mirrored FROM Booking (what the parent thinks the state is).
  booking_status        VARCHAR(50)  DEFAULT 'Pending',

  -- Fleet's OWN lifecycle status (the queue/dispatch state machine).
  fleet_status          VARCHAR(50)  NOT NULL DEFAULT 'Waiting for Fleet Review',

  -- Set once the request is approved and turned into a Fleet assignment.
  reservation_id        INT REFERENCES vehiclereservations(reservation_id),

  -- Why it was rejected/cancelled, if applicable.
  status_reason         TEXT,

  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Full Fleet lifecycle vocabulary. Kept in sync with
-- src/lib/constants.js RESERVATION_LIFECYCLE and reservation-state.js.
ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_fleet_status
  CHECK (fleet_status IN (
    'Pending',
    'Waiting for Fleet Review',
    'Approved',
    'Rejected',
    'Scheduled',
    'Driver Assigned',
    'Vehicle Assigned',
    'In Progress',
    'Completed',
    'Cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_transport_requests_external ON transportation_requests(external_booking_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_fleet_status ON transportation_requests(fleet_status);
CREATE INDEX IF NOT EXISTS idx_transport_requests_pickup ON transportation_requests(pickup_datetime);
CREATE INDEX IF NOT EXISTS idx_transport_requests_reservation ON transportation_requests(reservation_id);

COMMENT ON TABLE transportation_requests IS
  'Fleet Reservation Queue. Cache of transportation requests received from the parent Booking subsystem. Fleet reviews/approves and dispatches these; it never creates hotel reservations. external_booking_id is the idempotency key.';
COMMENT ON COLUMN transportation_requests.fleet_status IS
  'Fleet-internal lifecycle status. Mapped to a shared vocabulary before being sent back to Booking (see src/lib/integration/status-map.js).';
COMMENT ON COLUMN transportation_requests.booking_status IS
  'Status as reported by the Booking subsystem (read-only mirror).';

-- ============================================
-- 2. LINK vehiclereservations -> transportation_requests
--
-- vehiclereservations becomes the Fleet ASSIGNMENT record (which vehicle/driver,
-- what fleet status). Each assignment traces back to the request it fulfills.
-- ============================================

ALTER TABLE vehiclereservations
  ADD COLUMN IF NOT EXISTS request_id INT REFERENCES transportation_requests(request_id);

CREATE INDEX IF NOT EXISTS idx_reservations_request ON vehiclereservations(request_id);

COMMENT ON COLUMN vehiclereservations.request_id IS
  'Originating transportation request from the Booking subsystem.';

-- A dispatch created directly from an approved request (not via a
-- vehiclereservation) links back the same way, so trip completion can notify
-- Booking without depending on the legacy reservation row.
ALTER TABLE dispatchschedules
  ADD COLUMN IF NOT EXISTS request_id INT REFERENCES transportation_requests(request_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_request ON dispatchschedules(request_id);

COMMENT ON COLUMN dispatchschedules.request_id IS
  'Originating transportation request from the Booking subsystem (if this dispatch fulfils one).';

-- ============================================
-- 3. DEPRECATE guest-PII columns on vehiclereservations
--
-- These are mastered by the Booking subsystem. They are NOT dropped yet — a
-- later migration will remove them once all reads go through
-- transportation_requests. Commented so no new code treats Fleet as the owner.
-- ============================================

COMMENT ON COLUMN vehiclereservations.guest_name IS
  'DEPRECATED: guest identity is mastered by the Booking subsystem. Read from transportation_requests instead. Slated for removal.';
COMMENT ON COLUMN vehiclereservations.guest_phone IS
  'DEPRECATED: mastered by Booking. Fleet must not treat this as system-of-record. Slated for removal.';
COMMENT ON COLUMN vehiclereservations.guest_email IS
  'DEPRECATED: mastered by Booking. Slated for removal.';
COMMENT ON COLUMN vehiclereservations.guest_id IS
  'DEPRECATED: mastered by Booking. Use transportation_requests.external_booking_id for correlation. Slated for removal.';

-- ============================================
-- 4. updated_at trigger
-- ============================================

CREATE TRIGGER update_transportation_requests_updated_at
  BEFORE UPDATE ON transportation_requests FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 5. RLS (INERT — not the security boundary; see header note)
-- ============================================

ALTER TABLE transportation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view transport requests"
  ON transportation_requests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage transport requests"
  ON transportation_requests FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher']));
