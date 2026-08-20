-- Security hardening: registration is admin-only via POST /api/auth/register.
-- Migration 009 opened employees to the public anon role so a browser could
-- self-register (signUp / forgot / reset in src/services/auth.service.js) using
-- NEXT_PUBLIC_SUPABASE_ANON_KEY. That path also let anyone read emails and,
-- had an UPDATE grant ever landed, overwrite any account's password_hash.
--
-- The client-side anon-key code was removed in the same change; these policies
-- and grants are now revoked so the anon role can never touch employees even if
-- RLS is disabled or a future client bundles the anon key again.

-- 1. Drop the anon registration policies created by 009.
DROP POLICY IF EXISTS "Anyone can insert during registration" ON employees;
DROP POLICY IF EXISTS "Anyone can check email during registration" ON employees;

-- 2. Belt-and-suspenders: strip anon's table privileges entirely. REVOKE is
--    idempotent — revoking nothing is a no-op, not an error.
REVOKE ALL ON TABLE employees FROM anon;