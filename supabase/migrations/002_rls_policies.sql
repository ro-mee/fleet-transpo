-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiclecategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiclereservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatchschedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpstracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiclemaintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicleinspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicledocuments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicleassignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelstations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelrecords ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelconsumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelrequests ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelallocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE driverattendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE driverincidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tripcostanalysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE tripperformance ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobiledevices ENABLE ROW LEVEL SECURITY;
ALTER TABLE offlinesync ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTION: Get current employee role
-- ============================================

CREATE OR REPLACE FUNCTION get_current_employee_role()
RETURNS VARCHAR(100) AS $$
DECLARE
  user_role VARCHAR(100);
BEGIN
  SELECT r.role_name INTO user_role
  FROM employees e
  JOIN roles r ON e.role_id = r.role_id
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN user_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER: Check if user has role
-- ============================================

CREATE OR REPLACE FUNCTION has_role(required_roles TEXT[])
RETURNS BOOLEAN AS $$
DECLARE
  user_role VARCHAR(100);
BEGIN
  user_role := get_current_employee_role();
  RETURN user_role = ANY(required_roles);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- EMPLOYEES
-- ============================================

CREATE POLICY "Users can view their own profile"
  ON employees FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admin can view all employees"
  ON employees FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management']));

CREATE POLICY "Admin can manage employees"
  ON employees FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- VEHICLES
-- ============================================

CREATE POLICY "All authenticated can view vehicles"
  ON vehicles FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can manage vehicles"
  ON vehicles FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- VEHICLE CATEGORIES
-- ============================================

CREATE POLICY "All authenticated can view categories"
  ON vehiclecategories FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage categories"
  ON vehiclecategories FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- DRIVERS
-- ============================================

CREATE POLICY "All authenticated can view drivers"
  ON drivers FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can manage drivers"
  ON drivers FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- RESERVATIONS
-- ============================================

CREATE POLICY "Staff can view reservations"
  ON vehiclereservations FOR SELECT
  USING (
    has_role(ARRAY['admin', 'system_admin', 'management']) OR
    vehiclereservations.created_by = (
      SELECT employee_id FROM employees WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Staff can create reservations"
  ON vehiclereservations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Dispatchers and admin can update reservations"
  ON vehiclereservations FOR UPDATE
  USING (has_role(ARRAY['admin', 'system_admin', 'dispatcher', 'fleet_manager']));

-- ============================================
-- DISPATCH SCHEDULES
-- ============================================

CREATE POLICY "Authenticated can view dispatch schedules"
  ON dispatchschedules FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Dispatchers and admin can manage dispatch"
  ON dispatchschedules FOR ALL
  USING (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

-- ============================================
-- TRIPS
-- ============================================

CREATE POLICY "Authenticated can view trips"
  ON trips FOR SELECT
  USING (
    has_role(ARRAY['admin', 'system_admin', 'management', 'fleet_manager', 'dispatcher'])
    OR driver_id = (SELECT d.driver_id FROM drivers d JOIN employees e ON d.employee_id = e.employee_id WHERE e.user_id = auth.uid())
  );

CREATE POLICY "Dispatchers and admin can manage trips"
  ON trips FOR ALL
  USING (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));

-- ============================================
-- GPS TRACKING
-- ============================================

CREATE POLICY "Drivers can insert GPS"
  ON gpstracking FOR INSERT
  WITH CHECK (
    driver_id = (SELECT d.driver_id FROM drivers d JOIN employees e ON d.employee_id = e.employee_id WHERE e.user_id = auth.uid())
    OR has_role(ARRAY['admin', 'system_admin'])
  );

CREATE POLICY "Admin and fleet managers can view GPS"
  ON gpstracking FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

-- ============================================
-- MAINTENANCE
-- ============================================

CREATE POLICY "Authenticated can view maintenance"
  ON vehiclemaintenance FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet managers and admin can manage maintenance"
  ON vehiclemaintenance FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- FUEL RECORDS
-- ============================================

CREATE POLICY "Drivers can insert fuel records"
  ON fuelrecords FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin can view all fuel records"
  ON fuelrecords FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()) OR user_id = auth.uid());

-- ============================================
-- AUDIT LOGS
-- ============================================

CREATE POLICY "Only admin can view audit logs"
  ON audit_logs FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- DRIVER ATTENDANCE
-- ============================================

CREATE POLICY "Drivers can view own attendance"
  ON driverattendance FOR SELECT
  USING (
    driver_id = (SELECT d.driver_id FROM drivers d JOIN employees e ON d.employee_id = e.employee_id WHERE e.user_id = auth.uid())
    OR has_role(ARRAY['admin', 'fleet_manager', 'system_admin'])
  );

CREATE POLICY "Drivers can check in"
  ON driverattendance FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage attendance"
  ON driverattendance FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- AI RECOMMENDATIONS
-- ============================================

CREATE POLICY "Authenticated can view AI recommendations"
  ON ai_recommendations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "System can insert AI recommendations"
  ON ai_recommendations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their AI recommendations action"
  ON ai_recommendations FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ============================================
-- SYSTEM CONFIG
-- ============================================

CREATE POLICY "Only system admin can manage config"
  ON system_config FOR ALL
  USING (has_role(ARRAY['system_admin']));
