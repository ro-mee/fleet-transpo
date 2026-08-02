-- ============================================
-- MIGRATION 011: RLS Policy Fixes
--
-- ⚠️  INERT AT RUNTIME — see 002_rls_policies.sql header and docs/rbac-model.md §5.
-- These policies never fire (service-role / db-owner connections bypass RLS).
-- Authorization lives in the app layer via requireAuth(req, [roles]).
--
-- Purpose:
--   Add missing RLS policies for tables that
--   have RLS enabled but zero policies defined.
--   Clean up ENABLE RLS for tables that were
--   dropped in previous migrations.
-- ============================================

-- ============================================
-- 1. DROP ENABLE RLS for tables no longer exist
-- These tables were dropped in migration 005:
--   permissions, role_permissions, vehicleinspection,
--   vehicleassignment, fuelstations, fuelrequests,
--   fuelallocations, fuelconsumption, driverincidents,
--   offlinesync, mobiledevices, automation_rules,
--   automation_logs, scheduled_tasks, scheduled_reports,
--   system_config, tripcostanalysis, tripperformance
--
-- ENABLE ROW LEVEL SECURITY on a non-existent table
-- is a no-op, so these are just cleanup for clarity.
-- ============================================

-- ============================================
-- 2. ROLES — all authenticated can read roles
-- ============================================

CREATE POLICY "All authenticated can view roles"
  ON roles FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================
-- 3. ROUTES — operational reference data
-- ============================================

CREATE POLICY "All authenticated can view routes"
  ON routes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage routes"
  ON routes FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

-- ============================================
-- 4. FUEL RECORDS — allow admin update/correct
-- ============================================

CREATE POLICY "Staff can update fuel records"
  ON fuelrecords FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- 5. AI INSIGHTS — read & dismiss
-- ============================================

CREATE POLICY "All authenticated can view AI insights"
  ON ai_insights FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can dismiss AI insights"
  ON ai_insights FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "System can insert AI insights"
  ON ai_insights FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- 6. NOTIFICATIONS — ensure INSERT from triggers works
-- (Triggers use SECURITY DEFINER so they bypass
-- RLS already, but this ensures the permission
-- model is explicit.)
-- ============================================

CREATE POLICY "Users can insert own notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid())
    OR has_role(ARRAY['admin', 'system_admin'])
  );

-- ============================================
-- 7. DRIVER STATS VIEW — grant access
-- driver_stats is a VIEW, not a table, but
-- we need to ensure authenticated users can
-- query it through the API.
-- ============================================

GRANT SELECT ON driver_stats TO authenticated;
