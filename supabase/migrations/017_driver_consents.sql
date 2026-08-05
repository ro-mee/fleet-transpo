-- ============================================
-- MIGRATION 017: Driver Privacy Consent Records
--
-- Purpose:
--   Create the driver_consents audit table referenced by
--   POST /api/driver/me/consent and GET /api/driver/me.
--   Every acceptance of the Driver Data Privacy & Terms
--   policy is recorded (who, which version, when, from
--   which surface, and the originating IP) so consent is
--   traceable — the durable half of the consent gate that
--   the web and mobile apps already exercise.
--
-- Normalization note:
--   This is a NEW append-only table (an event log), not a
--   normalization of existing data. It is intentionally
--   minimal and append-only: one row per acceptance, no
--   UPDATE/DELETE in the service layer, and a version FK
--   concept kept as a plain integer because the policy
--   text lives in application code (src/lib/consent/),
--   not in a database table.
--
-- ============================================

-- ============================================
-- 1. CREATE driver_consents TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS driver_consents (
  consent_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  policy_version INT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_via VARCHAR(20) NOT NULL DEFAULT 'web'
    CHECK (accepted_via IN ('web', 'mobile')),
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE driver_consents IS
  'Audit trail of driver acceptances of the Driver Data Privacy & Terms policy. Append-only; the latest row per driver drives the consent gate.';

COMMENT ON COLUMN driver_consents.policy_version IS
  'Version of src/lib/consent/policies.js the driver accepted. The UI gate compares this to CURRENT_PRIVACY_POLICY_VERSION.';

COMMENT ON COLUMN driver_consents.accepted_via IS
  'Surface where consent was given: web app or mobile app.';

-- Index for the consent-gate lookup (latest acceptance per driver) and for
-- administration/audit queries (all acceptances of one driver).
CREATE INDEX IF NOT EXISTS idx_driver_consents_driver ON driver_consents(driver_id, accepted_at DESC);

-- ============================================
-- 2. RLS POLICIES
--    Mirrors the driver-scoped self-access pattern from
--    migration 006 (driverattendance): a driver may see
--    and record only their own consents; staff with
--    operations roles may read any for compliance/audit.
-- ============================================

ALTER TABLE driver_consents ENABLE ROW LEVEL SECURITY;

-- Drivers can view their own consent history.
CREATE POLICY "Drivers can view own consents"
  ON driver_consents FOR SELECT
  USING (
    driver_id IN (
      SELECT d.driver_id FROM drivers d
      JOIN employees e ON d.employee_id = e.employee_id
      WHERE e.user_id = auth.uid()
    )
  );

-- Drivers can record their own acceptance (the gate only inserts).
CREATE POLICY "Drivers can record own consent"
  ON driver_consents FOR INSERT
  WITH CHECK (
    driver_id IN (
      SELECT d.driver_id FROM drivers d
      JOIN employees e ON d.employee_id = e.employee_id
      WHERE e.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE policies: the table is append-only by design. A mistaken
-- acceptance is not corrected in place — a new acceptance supersedes it.

-- Staff with operations/admin roles can read consent records for audit.
CREATE POLICY "Staff can view driver consents"
  ON driver_consents FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management', 'dispatcher']));

-- ============================================
-- 3. SERVICE LAYER COMPATIBILITY
--    No service-layer changes required. The API routes
--    (src/app/api/driver/me/consent/route.js and
--     src/app/api/driver/me/route.js) already SELECT and
--    INSERT exactly these column names; their fallback
--    .catch()/no-op paths become unused once this table
--    exists.
-- ============================================
