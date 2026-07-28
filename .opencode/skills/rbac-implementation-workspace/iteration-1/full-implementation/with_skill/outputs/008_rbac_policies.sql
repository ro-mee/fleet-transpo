-- ============================================
-- RBAC POLICY FIXES — Phase 1 Implementation
-- ============================================
-- Implements the full RBAC model from docs/rbac-model.md
-- Covers: helper functions, fix existing policies, new policies for 16+ tables

-- ============================================
-- SECTION 1: Helper Functions
-- ============================================

-- get_current_employee_branch: Returns branch_id for the current auth user
CREATE OR REPLACE FUNCTION get_current_employee_branch()
RETURNS INT AS $$
DECLARE
  emp_branch INT;
BEGIN
  SELECT e.branch_id INTO emp_branch
  FROM employees e
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN emp_branch;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_current_employee_id: Returns employee_id for the current auth user
CREATE OR REPLACE FUNCTION get_current_employee_id()
RETURNS INT AS $$
DECLARE
  emp_id INT;
BEGIN
  SELECT e.employee_id INTO emp_id
  FROM employees e
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN emp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_current_driver_id: Returns driver_id if current user is a driver, NULL otherwise
CREATE OR REPLACE FUNCTION get_current_driver_id()
RETURNS INT AS $$
DECLARE
  d_id INT;
BEGIN
  SELECT d.driver_id INTO d_id
  FROM drivers d
  JOIN employees e ON d.employee_id = e.employee_id
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN d_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SECTION 2: Fix Existing Policies
-- ============================================

-- Fix 1: Remove management from employees SELECT (overly permissive)
DROP POLICY IF EXISTS "Admin can view all employees" ON employees;

CREATE POLICY "Admin can view all employees"
  ON employees FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

-- Fix 2: Add fleet_manager to reservations UPDATE
DROP POLICY IF EXISTS "Dispatchers and admin can update reservations" ON vehiclereservations;

CREATE POLICY "Dispatchers and admin can update reservations"
  ON vehiclereservations FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin', 'dispatcher', 'fleet_manager']));

-- Fix 3: Add fleet_manager to reservations DELETE
CREATE POLICY "Admin can delete reservations"
  ON vehiclereservations FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Fix 4: Add dispatcher to drivers SELECT (currently missing)
DROP POLICY IF EXISTS "All authenticated can view drivers" ON drivers;

CREATE POLICY "Authenticated can view drivers"
  ON drivers FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================
-- SECTION 3: New Policies for Tables With None
-- ============================================

-- ============================================
-- 3.1 ROLES, PERMISSIONS, ROLE_PERMISSIONS
-- ============================================

CREATE POLICY "Admin view roles"
  ON roles FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage roles"
  ON roles FOR ALL
  USING (has_role(ARRAY['system_admin']));

CREATE POLICY "Admin view permissions"
  ON permissions FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage permissions"
  ON permissions FOR ALL
  USING (has_role(ARRAY['system_admin']));

CREATE POLICY "Admin view role_permissions"
  ON role_permissions FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage role_permissions"
  ON role_permissions FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 3.2 ROUTES
-- ============================================

CREATE POLICY "All auth view routes"
  ON routes FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "Fleet managers manage routes"
  ON routes FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Fleet managers update routes"
  ON routes FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Admin can delete routes"
  ON routes FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.3 VEHICLE INSPECTION
-- ============================================

CREATE POLICY "All auth view inspections"
  ON vehicleinspection FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers manage inspections"
  ON vehicleinspection FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'driver']));

CREATE POLICY "Fleet managers update inspections"
  ON vehicleinspection FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete inspections"
  ON vehicleinspection FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.4 VEHICLE DOCUMENTS
-- ============================================

CREATE POLICY "Admin view vehicle documents"
  ON vehicledocuments FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']) AND deleted_at IS NULL);

CREATE POLICY "Fleet managers manage vehicle documents"
  ON vehicledocuments FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers update vehicle documents"
  ON vehicledocuments FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete vehicle documents"
  ON vehicledocuments FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.5 VEHICLE ASSIGNMENT
-- ============================================

CREATE POLICY "Admin view vehicle assignments"
  ON vehicleassignment FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']) AND deleted_at IS NULL);

CREATE POLICY "Fleet managers manage vehicle assignments"
  ON vehicleassignment FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- 3.6 FUEL STATIONS
-- ============================================

CREATE POLICY "All auth view fuel stations"
  ON fuelstations FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "Admin manage fuel stations"
  ON fuelstations FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.7 FUEL CONSUMPTION
-- ============================================

CREATE POLICY "Admin view fuel consumption"
  ON fuelconsumption FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher', 'management']));

CREATE POLICY "System only manage fuel consumption"
  ON fuelconsumption FOR ALL
  USING (false);

-- ============================================
-- 3.8 FUEL REQUESTS
-- ============================================

CREATE POLICY "All authenticated view fuel requests"
  ON fuelrequests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Drivers and fleet managers create fuel requests"
  ON fuelrequests FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers approve fuel requests"
  ON fuelrequests FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete fuel requests"
  ON fuelrequests FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.9 FUEL ALLOCATIONS
-- ============================================

CREATE POLICY "Admin view fuel allocations"
  ON fuelallocations FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'management']));

CREATE POLICY "Fleet managers manage fuel allocations"
  ON fuelallocations FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- 3.10 DRIVER INCIDENTS
-- ============================================

CREATE POLICY "Admin view all driver incidents"
  ON driverincidents FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));

CREATE POLICY "Drivers view own incidents"
  ON driverincidents FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Drivers and fleet managers create incidents"
  ON driverincidents FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers update incidents"
  ON driverincidents FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete incidents"
  ON driverincidents FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.11 AI INSIGHTS
-- ============================================

CREATE POLICY "All authenticated view AI insights"
  ON ai_insights FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "System only manage AI insights"
  ON ai_insights FOR ALL
  USING (false);

-- ============================================
-- 3.12 AUTOMATION RULES
-- ============================================

CREATE POLICY "Admin view automation rules"
  ON automation_rules FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage automation rules"
  ON automation_rules FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 3.13 AUTOMATION LOGS
-- ============================================

CREATE POLICY "Admin view automation logs"
  ON automation_logs FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

CREATE POLICY "System only insert automation logs"
  ON automation_logs FOR INSERT
  WITH CHECK (false);

-- ============================================
-- 3.14 SCHEDULED TASKS
-- ============================================

CREATE POLICY "Admin view scheduled tasks"
  ON scheduled_tasks FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin manage scheduled tasks"
  ON scheduled_tasks FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 3.15 SCHEDULED REPORTS
-- ============================================

CREATE POLICY "Admin view scheduled reports"
  ON scheduled_reports FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management']));

CREATE POLICY "Fleet managers manage scheduled reports"
  ON scheduled_reports FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

CREATE POLICY "Fleet managers update scheduled reports"
  ON scheduled_reports FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

CREATE POLICY "Admin can delete scheduled reports"
  ON scheduled_reports FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.16 MOBILE DEVICES
-- ============================================

CREATE POLICY "Admin view mobile devices"
  ON mobiledevices FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Drivers view own mobile devices"
  ON mobiledevices FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Drivers and admin register devices"
  ON mobiledevices FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'system_admin']));

CREATE POLICY "Drivers update own devices"
  ON mobiledevices FOR UPDATE
  USING (driver_id = get_current_driver_id() OR has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 3.17 OFFLINE SYNC
-- ============================================

CREATE POLICY "Admin view offline sync"
  ON offlinesync FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System only insert offline sync"
  ON offlinesync FOR INSERT
  WITH CHECK (false);

-- ============================================
-- SECTION 4: Add Missing DELETE Policies to Existing Tables
-- ============================================

-- Vehicles
CREATE POLICY "Admin can delete vehicles"
  ON vehicles FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Vehicle categories
CREATE POLICY "Admin can delete vehicle categories"
  ON vehiclecategories FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Drivers
CREATE POLICY "Admin can delete drivers"
  ON drivers FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Trips
CREATE POLICY "Admin can delete trips"
  ON trips FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Dispatch schedules
CREATE POLICY "Admin can delete dispatch schedules"
  ON dispatchschedules FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Vehicle maintenance
CREATE POLICY "Admin can delete maintenance"
  ON vehiclemaintenance FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Fuel records
CREATE POLICY "Admin can delete fuel records"
  ON fuelrecords FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- Driver attendance
CREATE POLICY "Admin can delete attendance"
  ON driverattendance FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- SECTION 5: Trip Cost Analysis & Trip Performance
-- ============================================

CREATE POLICY "Admin view trip cost analysis"
  ON tripcostanalysis FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "System only manage trip cost analysis"
  ON tripcostanalysis FOR ALL
  USING (false);

CREATE POLICY "Admin view trip performance"
  ON tripperformance FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "Drivers view own trip performance"
  ON tripperformance FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "System only manage trip performance"
  ON tripperformance FOR ALL
  USING (false);

-- ============================================
-- SECTION 6: Dispatch Schedules — Branch-scoped for staff roles
-- ============================================

-- Drop the overly broad existing policy and recreate with role-specific policies
DROP POLICY IF EXISTS "Authenticated can view dispatch schedules" ON dispatchschedules;

CREATE POLICY "Admin management view dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "Staff view branch dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (
    has_role(ARRAY['reception_staff', 'concierge', 'restaurant_staff'])
    AND EXISTS (
      SELECT 1 FROM vehiclereservations vr
      WHERE vr.branch_id = get_current_employee_branch()
      AND vr.reservation_id = dispatchschedules.reservation_id
    )
  );

CREATE POLICY "Drivers view own dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (driver_id = get_current_driver_id());

-- ============================================
-- SECTION 7: GPS Tracking — Add driver own-data view and history
-- ============================================

DROP POLICY IF EXISTS "Admin and fleet managers can view GPS" ON gpstracking;

CREATE POLICY "Admin ops view live GPS"
  ON gpstracking FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Management view GPS history"
  ON gpstracking FOR SELECT
  USING (has_role(ARRAY['management'])
    AND recorded_at < NOW() - INTERVAL '1 hour');

CREATE POLICY "Drivers view own GPS"
  ON gpstracking FOR SELECT
  USING (driver_id = get_current_driver_id());
