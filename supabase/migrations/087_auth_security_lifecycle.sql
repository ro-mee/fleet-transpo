-- ============================================
-- MIGRATION 087: Auth security lifecycle
--
-- Credential/session versioning lets the application invalidate stateless web
-- and mobile access tokens after a password, email, role, or account-status
-- change. The limiter table keeps authentication throttles shared across app
-- instances and restarts.
-- ============================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key     TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count      INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated
  ON auth_rate_limits (updated_at);

ALTER TABLE mobile_refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

UPDATE mobile_refresh_tokens
   SET family_id = uuid_generate_v4()
 WHERE family_id IS NULL;

ALTER TABLE mobile_refresh_tokens
  ALTER COLUMN family_id SET DEFAULT uuid_generate_v4(),
  ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_refresh_tokens_family
  ON mobile_refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id    BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_employee
  ON password_reset_tokens (employee_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry
  ON password_reset_tokens (expires_at);
