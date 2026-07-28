-- ============================================
-- ROW LEVEL SECURITY POLICIES — Phase 2
-- Covers routes + fuel tables (Section 5.7, 5.14)
-- ============================================

-- Drop overly permissive existing fuelrecords policies from 002
DROP POLICY IF EXISTS "Drivers can insert fuel records" ON fuelrecords;
DROP POLICY IF EXISTS "Admin can view all fuel records" ON fuelrecords;

-- ============================================
-- ROUTES (Section 5.7)
-- ============================================

CREATE POLICY "All authenticated can view routes"
  ON routes FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "Admin, fleet managers, and dispatchers can manage routes"
  ON routes FOR INSERT
  WITH CHECK (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Admin, fleet managers, and dispatchers can update routes"
  ON routes FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'dispatcher', 'system_admin']));

CREATE POLICY "Admin can soft-delete routes"
  ON routes FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- FUEL STATIONS (Section 5.14)
-- ============================================

CREATE POLICY "All authenticated can view fuel stations"
  ON fuelstations FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "Admin can manage fuel stations"
  ON fuelstations FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- FUEL CONSUMPTION (Section 5.14)
-- ============================================

CREATE POLICY "Ops roles and management can view fuel consumption"
  ON fuelconsumption FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'dispatcher', 'management']));

CREATE POLICY "System only manages fuel consumption"
  ON fuelconsumption FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- FUEL REQUESTS (Section 5.14)
-- ============================================

CREATE POLICY "All authenticated can view fuel requests"
  ON fuelrequests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Drivers and ops roles can create fuel requests"
  ON fuelrequests FOR INSERT
  WITH CHECK (has_role(ARRAY['driver', 'admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Ops roles can approve fuel requests"
  ON fuelrequests FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can delete fuel requests"
  ON fuelrequests FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));

-- ============================================
-- FUEL ALLOCATIONS (Section 5.14)
-- ============================================

CREATE POLICY "Ops and management can view fuel allocations"
  ON fuelallocations FOR SELECT
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin', 'management']));

CREATE POLICY "Ops roles can manage fuel allocations"
  ON fuelallocations FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

-- ============================================
-- FUEL RECORDS (Section 5.14)
-- ============================================

CREATE POLICY "All authenticated can view fuel records"
  ON fuelrecords FOR SELECT
  USING (auth.role() = 'authenticated' AND deleted_at IS NULL);

CREATE POLICY "All authenticated can insert fuel records"
  ON fuelrecords FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Ops roles can update fuel records"
  ON fuelrecords FOR UPDATE
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "Admin can soft-delete fuel records"
  ON fuelrecords FOR DELETE
  USING (has_role(ARRAY['admin', 'system_admin']));