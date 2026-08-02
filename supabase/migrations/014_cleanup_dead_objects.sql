-- ============================================
-- MIGRATION 014: Cleanup Dead DB Objects
--
-- Drops functions/triggers that reference removed
-- branches columns or a nonexistent profiles table.
-- Created ad-hoc (not in earlier migrations), never
-- called by app code. Keeping them is a landmine.
-- ============================================

-- Broken auth trigger: inserts into public.profiles (table does not exist)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Stale functions referencing dropped branch_id columns / nonexistent profiles
DROP FUNCTION IF EXISTS get_dashboard_stats(uuid);
DROP FUNCTION IF EXISTS get_user_branch();
DROP FUNCTION IF EXISTS get_current_user_role();
DROP FUNCTION IF EXISTS is_super_admin();

-- Unused audit system referencing dropped audit_logs.branch_id
DROP FUNCTION IF EXISTS log_audit_event();
DROP FUNCTION IF EXISTS apply_audit_trigger(table_name text);
