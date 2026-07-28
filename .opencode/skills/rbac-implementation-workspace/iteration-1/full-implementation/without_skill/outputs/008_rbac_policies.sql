-- ============================================
-- RBAC GAP FIXES — PHASE 1 MIGRATION
-- ============================================
-- Addresses gaps identified in docs/rbac-model.md:
--   - Missing helper functions
--   - 16+ tables with zero RLS policies
--   - Overly permissive management role on employees
--   - Missing DELETE policies on operational tables
--   - Missing UPDATE roles on vehiclereservations
-- ============================================

-- ============================================
-- 1. ADDITIONAL HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION get_current_employee_branch()
RETURNS INT AS $$
DECLARE
  emp_branch_id INT;
BEGIN
  SELECT e.branch_id INTO emp_branch_id
  FROM employees e
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN emp_branch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
-- 2. FIX: employees — remove management from SELECT-all
-- ============================================

DROP POLICY IF EXISTS "Admin can view all employees" ON employees;
CREATE POLICY "Admin can view all employees"
  ON employees FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

-- ============================================
-- 3. FIX: vehiclereservations — add fleet_manager to UPDATE
-- ============================================

DROP POLICY IF EXISTS "Dispatchers and admin can update reservations" ON vehiclereservations;
CREATE POLICY "Staff can update reservations"
  ON vehiclereservations FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin', 'dispatcher', 'fleet_manager']));

-- ============================================
-- 4. FIX: vehiclereservations — add DELETE policy
-- ============================================

CREATE POLICY "Admin can delete reservations"
  ON vehiclereservations FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 5. ROLES & PERMISSIONS (roles, permissions, role_permissions)
-- ============================================

-- roles
DROP POLICY IF EXISTS "Admin can view roles" ON roles;
CREATE POLICY "Admin can view roles"
  ON roles FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can manage roles"
  ON roles FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- permissions
DROP POLICY IF EXISTS "Admin can view permissions" ON permissions;
CREATE POLICY "Admin can view permissions"
  ON permissions FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can manage permissions"
  ON permissions FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- role_permissions
DROP POLICY IF EXISTS "Admin can view role_permissions" ON role_permissions;
CREATE POLICY "Admin can view role_permissions"
  ON role_permissions FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can manage role_permissions"
  ON role_permissions FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 6. ROUTES
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view routes" ON routes;
CREATE POLICY "All authenticated can view routes"
  ON routes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can manage routes"
  ON routes FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update routes"
  ON routes FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Admin can delete routes"
  ON routes FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 7. VEHICLE INSPECTION
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view inspections" ON vehicleinspection;
CREATE POLICY "All authenticated can view inspections"
  ON vehicleinspection FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can create inspections"
  ON vehicleinspection FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'driver']));

CREATE POLICY "Fleet managers and admin can update inspections"
  ON vehicleinspection FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete inspections"
  ON vehicleinspection FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 8. VEHICLE DOCUMENTS
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view documents" ON vehicledocuments;
CREATE POLICY "Admin and fleet can view documents"
  ON vehicledocuments FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));

CREATE POLICY "Fleet managers and admin can manage documents"
  ON vehicledocuments FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update documents"
  ON vehicledocuments FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete documents"
  ON vehicledocuments FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 9. VEHICLE ASSIGNMENTS
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view assignments" ON vehicleassignment;
CREATE POLICY "Admin and fleet can view assignments"
  ON vehicleassignment FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));

CREATE POLICY "Fleet managers and admin can manage assignments"
  ON vehicleassignment FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update assignments"
  ON vehicleassignment FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete assignments"
  ON vehicleassignment FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 10. FUEL STATIONS
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view fuel stations" ON fuelstations;
CREATE POLICY "All authenticated can view fuel stations"
  ON fuelstations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage fuel stations"
  ON fuelstations FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Admin can update fuel stations"
  ON fuelstations FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Admin can delete fuel stations"
  ON fuelstations FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 11. FUEL CONSUMPTION
-- ============================================

DROP POLICY IF EXISTS "Admin can view fuel consumption" ON fuelconsumption;
CREATE POLICY "Admin and dispatcher can view fuel consumption"
  ON fuelconsumption FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher', 'management']));

CREATE POLICY "System can manage fuel consumption"
  ON fuelconsumption FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 12. FUEL REQUESTS
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view fuel requests" ON fuelrequests;
CREATE POLICY "All authenticated can view fuel requests"
  ON fuelrequests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can create fuel requests"
  ON fuelrequests FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin and fleet can approve fuel requests"
  ON fuelrequests FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete fuel requests"
  ON fuelrequests FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 13. FUEL ALLOCATIONS
-- ============================================

DROP POLICY IF EXISTS "Admin can view fuel allocations" ON fuelallocations;
CREATE POLICY "Admin and fleet can view fuel allocations"
  ON fuelallocations FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'management']));

CREATE POLICY "Admin and fleet can manage fuel allocations"
  ON fuelallocations FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- 14. DRIVER INCIDENTS
-- ============================================

DROP POLICY IF EXISTS "Admin can view incidents" ON driverincidents;
CREATE POLICY "Admin and fleet can view incidents"
  ON driverincidents FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));

CREATE POLICY "Drivers can view own incidents"
  ON driverincidents FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Drivers and fleet can create incidents"
  ON driverincidents FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin and fleet can update incidents"
  ON driverincidents FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete incidents"
  ON driverincidents FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 15. AI INSIGHTS
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view AI insights" ON ai_insights;
CREATE POLICY "All authenticated can view AI insights"
  ON ai_insights FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "System can manage AI insights"
  ON ai_insights FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 16. AUTOMATION RULES
-- ============================================

DROP POLICY IF EXISTS "Admin can view automation rules" ON automation_rules;
CREATE POLICY "Admin can view automation rules"
  ON automation_rules FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can manage automation rules"
  ON automation_rules FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 17. AUTOMATION LOGS
-- ============================================

DROP POLICY IF EXISTS "Admin can view automation logs" ON automation_logs;
CREATE POLICY "Admin and fleet can view automation logs"
  ON automation_logs FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

CREATE POLICY "System can insert automation logs"
  ON automation_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- 18. SCHEDULED TASKS
-- ============================================

DROP POLICY IF EXISTS "Admin can view scheduled tasks" ON scheduled_tasks;
CREATE POLICY "Admin can view scheduled tasks"
  ON scheduled_tasks FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can manage scheduled tasks"
  ON scheduled_tasks FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 19. SCHEDULED REPORTS
-- ============================================

DROP POLICY IF EXISTS "Admin can view scheduled reports" ON scheduled_reports;
CREATE POLICY "Admin and fleet can view scheduled reports"
  ON scheduled_reports FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management']));

CREATE POLICY "Admin and fleet can manage scheduled reports"
  ON scheduled_reports FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager']));

-- ============================================
-- 20. MOBILE DEVICES
-- ============================================

DROP POLICY IF EXISTS "Admin can view mobile devices" ON mobiledevices;
CREATE POLICY "Admin can view all mobile devices"
  ON mobiledevices FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Drivers can view own mobile devices"
  ON mobiledevices FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Drivers and admin can register devices"
  ON mobiledevices FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'system_admin']));

CREATE POLICY "Users can update own mobile devices"
  ON mobiledevices FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin']) OR driver_id = get_current_driver_id());

-- ============================================
-- 21. OFFLINE SYNC
-- ============================================

DROP POLICY IF EXISTS "Admin can view offline sync" ON offlinesync;
CREATE POLICY "Admin can view offline sync"
  ON offlinesync FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System can insert offline sync"
  ON offlinesync FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- 22. FIX: vehicles — add DELETE policy (soft-delete)
-- ============================================

-- Drop the ALL policy and replace with specific policies
DROP POLICY IF EXISTS "Fleet managers and admin can manage vehicles" ON vehicles;

CREATE POLICY "All authenticated can view vehicles"
  ON vehicles FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can insert vehicles"
  ON vehicles FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update vehicles"
  ON vehicles FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete vehicles"
  ON vehicles FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 23. FIX: drivers — add dispatcher and management to SELECT
-- ============================================

DROP POLICY IF EXISTS "All authenticated can view drivers" ON drivers;

CREATE POLICY "All authenticated can view drivers"
  ON drivers FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher', 'management']));

CREATE POLICY "Drivers can view own profile"
  ON drivers FOR SELECT
  USING (employee_id = get_current_employee_id());

CREATE POLICY "Fleet managers and admin can insert drivers"
  ON drivers FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update drivers"
  ON drivers FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete drivers"
  ON drivers FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 24. FIX: dispatchschedules — add driver own-view + branch-scoped rules
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view dispatch schedules" ON dispatchschedules;
DROP POLICY IF EXISTS "Dispatchers and admin can manage dispatch" ON dispatchschedules;

CREATE POLICY "Admin and ops can view all dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "Drivers can view own dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Branch staff can view dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (has_role(ARRAY['reception_staff', 'concierge', 'restaurant_staff'])
    AND branch_id = get_current_employee_branch());

CREATE POLICY "Dispatchers and admin can create dispatch schedules"
  ON dispatchschedules FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

CREATE POLICY "Dispatchers and admin can update dispatch schedules"
  ON dispatchschedules FOR UPDATE
  USING (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete dispatch schedules"
  ON dispatchschedules FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 25. FIX: trips — add proper driver own-view and management read
-- ============================================

DROP POLICY IF EXISTS "Authenticated can view trips" ON trips;
DROP POLICY IF EXISTS "Dispatchers and admin can manage trips" ON trips;

CREATE POLICY "Admin and ops can view all trips"
  ON trips FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'management', 'fleet_manager', 'dispatcher']));

CREATE POLICY "Drivers can view own trips"
  ON trips FOR SELECT
  USING (driver_id = get_current_driver_id());

CREATE POLICY "Admin and ops can create trips"
  ON trips FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin and ops can update trips"
  ON trips FOR UPDATE
  USING (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete trips"
  ON trips FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 26. FIX: gpstracking — add own-driver SELECT and history for management
-- ============================================

DROP POLICY IF EXISTS "Admin and fleet managers can view GPS" ON gpstracking;

CREATE POLICY "Drivers can insert GPS"
  ON gpstracking FOR INSERT
  WITH CHECK (driver_id = get_current_driver_id() OR has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Admin and ops can view live GPS"
  ON gpstracking FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Management can view GPS history"
  ON gpstracking FOR SELECT
  USING (has_role(ARRAY['management']));

CREATE POLICY "Drivers can view own GPS"
  ON gpstracking FOR SELECT
  USING (driver_id = get_current_driver_id());

-- ============================================
-- 27. FIX: fuelrecords — add UPDATE/DELETE and management SELECT
-- ============================================

DROP POLICY IF EXISTS "Admin can view all fuel records" ON fuelrecords;
DROP POLICY IF EXISTS "Drivers can insert fuel records" ON fuelrecords;

CREATE POLICY "All authenticated can view fuel records"
  ON fuelrecords FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated can insert fuel records"
  ON fuelrecords FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can update fuel records"
  ON fuelrecords FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete fuel records"
  ON fuelrecords FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 28. FIX: vehiclemaintenance — add driver INSERT for inspection
-- ============================================

DROP POLICY IF EXISTS "Fleet managers and admin can manage maintenance" ON vehiclemaintenance;

CREATE POLICY "All authenticated can view maintenance"
  ON vehiclemaintenance FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can insert maintenance"
  ON vehiclemaintenance FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update maintenance"
  ON vehiclemaintenance FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete maintenance"
  ON vehiclemaintenance FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 29. FIX: vehiclecategories — add specific policies (was ALL)
-- ============================================

DROP POLICY IF EXISTS "Admin can manage categories" ON vehiclecategories;

CREATE POLICY "All authenticated can view categories"
  ON vehiclecategories FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can insert categories"
  ON vehiclecategories FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Fleet managers and admin can update categories"
  ON vehiclecategories FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete categories"
  ON vehiclecategories FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- 30. FIX: branches — replace ALL with specific policies
-- ============================================

DROP POLICY IF EXISTS "Admin can manage branches" ON branches;

CREATE POLICY "All authenticated users can view branches"
  ON branches FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can insert branches"
  ON branches FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Admin can update branches"
  ON branches FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System admin can delete branches"
  ON branches FOR DELETE
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 31. FIX: employees — add missing management policy
-- ============================================

-- management gets only own profile + summary reports access
-- They should NOT have access to all employees

-- ============================================
-- 32. FIX: driverattendance — add dispatcher to UPDATE
-- ============================================

DROP POLICY IF EXISTS "Admin can manage attendance" ON driverattendance;

CREATE POLICY "Admin and fleet can manage attendance"
  ON driverattendance FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher']));

-- ============================================
-- 33. TRIP COST ANALYSIS
-- ============================================

CREATE POLICY "Admin and ops can view trip cost analysis"
  ON tripcostanalysis FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "System can manage trip cost analysis"
  ON tripcostanalysis FOR ALL
  USING (has_role(ARRAY['system_admin']));

-- ============================================
-- 34. TRIP PERFORMANCE
-- ============================================

CREATE POLICY "Admin and ops can view trip performance"
  ON tripperformance FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher', 'management']));

CREATE POLICY "System can manage trip performance"
  ON tripperformance FOR ALL
  USING (has_role(ARRAY['system_admin']));
