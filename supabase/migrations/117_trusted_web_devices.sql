BEGIN;

-- A remembered browser is a revocable, server-backed MFA bypass, not a value
-- the client can invent. Store only a SHA-256 hash of the random cookie token;
-- bind it to the employee's auth_version so password/email/MFA changes retire
-- every remembered device even before cleanup reaches old rows.
CREATE TABLE IF NOT EXISTS trusted_web_devices (
  device_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  auth_version BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  ip_address   VARCHAR(50),
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_trusted_web_devices_employee_active
  ON trusted_web_devices (employee_id, revoked_at, expires_at);

-- The application uses the owner connection through DATABASE_URL. Public
-- PostgREST roles must have neither read nor write access to this table.
ALTER TABLE trusted_web_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON trusted_web_devices FROM anon, authenticated;

COMMIT;
