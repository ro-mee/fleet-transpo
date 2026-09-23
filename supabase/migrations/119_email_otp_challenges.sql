BEGIN;

-- ============================================
-- MIGRATION 119: email OTP login challenges
--
-- Replaces TOTP as the second factor with a one-time code emailed to the
-- account's registered address. See the Decision Log entry of 2026-09-22 for
-- why, and Authentication.md for the resulting contract.
--
-- WHY A TABLE AND NOT A SIGNED TOKEN
-- ----------------------------------
-- The code is verified server-side against a stored hash so that it can be
-- single-use, attempt-limited and revocable. A self-contained signed token
-- cannot be invalidated once handed out, and cannot carry an attempt counter
-- that survives across requests without a store anyway.
--
-- WHY code_hash IS CHAR(64) AND NOT A SECRET
-- ------------------------------------------
-- The code is generated per login and lives five minutes. There is no
-- long-lived shared secret to encrypt, which is why `employee_mfa`'s
-- AES-256-GCM pattern (`MFA_ENCRYPTION_KEY`) does NOT carry over. Only a
-- SHA-256 hex digest is stored, the same shape as
-- `trusted_web_devices.token_hash` and `mfa_recovery_codes.code_hash`.
-- A stolen digest is not replayable without a preimage attack.
--
-- WHY auth_version IS BOUND IN
-- ----------------------------
-- Same reason `trusted_web_devices` carries it: a challenge issued before a
-- password/email/role/account change must not be redeemable after it. The
-- verifier re-reads `employees.auth_version` and refuses a mismatch, so the
-- shared auth lifecycle retires outstanding challenges without a sweep.
--
-- WHY RLS IS ENABLED AND THE GRANTS REVOKED
-- -----------------------------------------
-- This table is created AFTER migration 100, which was a one-time list of 20
-- tables and is NOT a standing rule — tables created later do not inherit it.
-- That is precisely how `app_errors`, `ai_prompt_templates` and
-- `trip_monitor_alerts` ended up readable with the public anon key
-- (SEC-DB-003), and how a `200 []` probe on an empty table was mistaken for
-- safety. So RLS is enabled explicitly here.
--
-- RLS alone is NOT sufficient: row security does not apply to TRUNCATE, so a
-- table with RLS on and an anon TRUNCATE grant is still one statement from
-- being emptied. Both mechanisms are applied; neither is sufficient alone.
-- This table is not a VIEW, so `security_invoker` does not apply.
--
-- The application reaches Postgres only through `query()` in src/lib/db.js over
-- DATABASE_URL, which authenticates as `postgres` with BYPASSRLS. Row security
-- is never evaluated against that role, so enabling it cannot change a single
-- row the application sees. No browser code reads this table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- ENABLE ROW LEVEL SECURITY is a no-op where already enabled, and REVOKE of a
-- privilege not held is a no-op.
-- ============================================

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id  INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  code_hash    CHAR(64) NOT NULL,
  -- 'login'          self-service code, emailed to the account address.
  -- 'break_glass'    admin-issued emergency code, shown on screen and read to
  --                  a locked-out user. Never emailed.
  purpose      VARCHAR(16) NOT NULL DEFAULT 'login',
  attempts     SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  auth_version BIGINT NOT NULL,
  consumed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   VARCHAR(50),
  user_agent   TEXT,
  CONSTRAINT email_otp_challenges_purpose_check
    CHECK (purpose IN ('login', 'break_glass'))
);

-- The verifier looks up the newest live challenge for one employee, so the
-- index leads with employee_id and filters on the two liveness columns.
CREATE INDEX IF NOT EXISTS idx_email_otp_challenges_employee_live
  ON email_otp_challenges (employee_id, consumed_at, expires_at);

-- The application uses the owner connection through DATABASE_URL. Public
-- PostgREST roles must have neither read nor write access to this table.
ALTER TABLE email_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON email_otp_challenges FROM anon, authenticated;

COMMIT;
