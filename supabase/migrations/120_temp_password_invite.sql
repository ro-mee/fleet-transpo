-- 120_temp_password_invite.sql
-- Temporary-password invitations: admins create accounts without choosing a
-- password; the server generates one, emails it, and the employee must replace
-- it at first sign-in (must_change_password), before temp_credential_expires_at.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temp_credential_expires_at timestamptz;
