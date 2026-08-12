-- ============================================
-- MIGRATION 014: Mobile Refresh Tokens
--
-- Purpose:
--   Back the mobile app's bearer-token auth.
--   Access tokens are stateless (signature-only,
--   15 min, no DB hit). Refresh tokens live 30
--   days, so they MUST be revocable: lost phone,
--   terminated employee, or extracted token.
--   This table is the revocation list.
--
--   Only the sha256 hash of the token is stored,
--   for the same reason employees.password_hash
--   stores a hash instead of the password.
--
--   No RLS policies: application code reaches the
--   DB through the raw pg pool as the owner role,
--   where auth.uid() is always NULL. Ownership is
--   enforced in src/lib/api/utils.js instead.
-- ============================================

CREATE TABLE IF NOT EXISTS mobile_refresh_tokens (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

-- Refresh looks up by hash (covered by the UNIQUE
-- constraint); "sign out all devices" goes by employee.
CREATE INDEX IF NOT EXISTS idx_mobile_refresh_tokens_employee
  ON mobile_refresh_tokens (employee_id);

-- ============================================
-- MAINTENANCE
--
-- Rotation inserts one row per refresh and revokes
-- the old one, so rows accumulate. Nothing in the
-- app deletes them. Schedule this periodically
-- (pg_cron, or a manual run) once the app is live:
--
--   DELETE FROM mobile_refresh_tokens
--   WHERE expires_at < NOW() - INTERVAL '30 days';
--
-- The 30-day grace keeps recently-expired rows
-- around long enough to investigate a suspected
-- token theft.
-- ============================================
