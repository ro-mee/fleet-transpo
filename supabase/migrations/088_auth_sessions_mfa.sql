-- ============================================
-- MIGRATION 088: server-backed sessions and employee MFA
-- ============================================

CREATE TABLE IF NOT EXISTS web_sessions (
  session_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_address  VARCHAR(50),
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_employee_active
  ON web_sessions (employee_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS employee_mfa (
  employee_id          INT PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
  secret_ciphertext    TEXT NOT NULL,
  secret_iv            TEXT NOT NULL,
  secret_tag           TEXT NOT NULL,
  setup_expires_at     TIMESTAMPTZ,
  enabled_at           TIMESTAMPTZ,
  last_used_step       BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_mfa_enabled
  ON employee_mfa (enabled_at);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  recovery_code_id BIGSERIAL PRIMARY KEY,
  employee_id      INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  code_hash        CHAR(64) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_employee
  ON mfa_recovery_codes (employee_id, used_at);
