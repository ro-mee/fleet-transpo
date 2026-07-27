-- ============================================
-- MIGRATION 005: Schema Cleanup
-- 
-- Purpose: Remove unnecessary tables and merge
-- fields into parent tables for simplicity.
--
-- From 40 tables → 22 tables
-- ============================================

-- ============================================
-- 1. SIMPLIFY RBAC: Merge permissions into roles
-- ============================================

ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;

DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;

-- ============================================
-- 2. MERGE vehicleinspection INTO vehiclemaintenance
-- ============================================

ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS inspection_checklist JSONB;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS inspection_findings TEXT;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS severity VARCHAR(20);

DROP TABLE IF EXISTS vehicleinspection CASCADE;

-- ============================================
-- 3. MERGE vehicledocuments INTO vehicles
-- ============================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb;

DROP TABLE IF EXISTS vehicledocuments CASCADE;

-- ============================================
-- 4. DROP vehicleassignment (redundant with dispatch)
-- ============================================

DROP TABLE IF EXISTS vehicleassignment CASCADE;

-- ============================================
-- 5. SIMPLIFY fuelrecords: drop station FK, add text field
-- ============================================

ALTER TABLE fuelrecords DROP COLUMN IF EXISTS station_id CASCADE;
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS station_name VARCHAR(255);

DROP TABLE IF EXISTS fuelstations CASCADE;
DROP TABLE IF EXISTS fuelrequests CASCADE;
DROP TABLE IF EXISTS fuelallocations CASCADE;
DROP TABLE IF EXISTS fuelconsumption CASCADE;

-- ============================================
-- 6. DROP driver extras
-- ============================================

DROP TABLE IF EXISTS driverattendance CASCADE;
DROP TABLE IF EXISTS driverincidents CASCADE;

-- ============================================
-- 7. DROP mobile/offline tables
-- ============================================

DROP TABLE IF EXISTS offlinesync CASCADE;
DROP TABLE IF EXISTS mobiledevices CASCADE;

-- ============================================
-- 8. DROP automation tables
-- ============================================

DROP TABLE IF EXISTS automation_logs CASCADE;
DROP TABLE IF EXISTS automation_rules CASCADE;

-- ============================================
-- 9. DROP scheduling tables
-- ============================================

DROP TABLE IF EXISTS scheduled_reports CASCADE;
DROP TABLE IF EXISTS scheduled_tasks CASCADE;

-- ============================================
-- 10. DROP system_config
-- ============================================

DROP TABLE IF EXISTS system_config CASCADE;

-- ============================================
-- 11. UPDATE RLS: Remove policies for dropped tables
-- ============================================

DROP POLICY IF EXISTS "Admin can manage permissions" ON permissions;
DROP POLICY IF EXISTS "All authenticated can view permissions" ON permissions;
DROP POLICY IF EXISTS "Admin can manage role_permissions" ON role_permissions;
DROP POLICY IF EXISTS "All authenticated can view role_permissions" ON role_permissions;
DROP POLICY IF EXISTS "Admin can manage fuel stations" ON fuelstations;
DROP POLICY IF EXISTS "All authenticated can view fuel stations" ON fuelstations;
DROP POLICY IF EXISTS "Drivers can view own attendance" ON driverattendance;
DROP POLICY IF EXISTS "Drivers can check in" ON driverattendance;
DROP POLICY IF EXISTS "Admin can manage attendance" ON driverattendance;
DROP POLICY IF EXISTS "Admin can view automation logs" ON automation_logs;
DROP POLICY IF EXISTS "Only system admin can manage config" ON system_config;

-- ============================================
-- 12. CLEANUP: Remove empty or redundant indexes
-- ============================================

DROP INDEX IF EXISTS idx_attendance_driver;
DROP INDEX IF EXISTS idx_attendance_date;
DROP INDEX IF EXISTS idx_integration_created;

-- ============================================
-- 13. REMOVE triggers for dropped tables
-- ============================================

DROP TRIGGER IF EXISTS trigger_notify_document_expiry ON vehicledocuments;
DROP FUNCTION IF EXISTS notify_document_expiry;

-- ============================================
-- 14. UPDATE NOTIFICATION TRIGGERS
-- Remove reference to deleted tables
-- ============================================

CREATE OR REPLACE FUNCTION notify_reservation_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Approved' AND OLD.status = 'Pending' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Reservation Approved',
      'Reservation #' || NEW.reservation_id || ' has been approved.',
      'Success',
      'reservation',
      NEW.reservation_id
    FROM employees e
    WHERE e.employee_id = NEW.created_by;

    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Reservation Approved',
      'Reservation #' || NEW.reservation_id || ' has been approved and ready for dispatch.',
      'Success',
      'reservation',
      NEW.reservation_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('dispatcher', 'fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_dispatch_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have been assigned to dispatch ' || NEW.dispatch_number || '.',
    'Info',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_maintenance_due()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.maintenance_date <= CURRENT_DATE + INTERVAL '7 days' AND (OLD IS NULL OR OLD.maintenance_date > CURRENT_DATE + INTERVAL '7 days') THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Maintenance Due Soon',
      'Vehicle maintenance is scheduled for ' || NEW.maintenance_date || '. Type: ' || NEW.maintenance_type,
      'Warning',
      'maintenance',
      NEW.maintenance_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_trip_completed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trip_status = 'Completed' AND OLD.trip_status != 'Completed' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    VALUES (
      (SELECT created_by FROM dispatchschedules WHERE dispatch_id = NEW.dispatch_id),
      'Trip Completed',
      'Trip #' || NEW.trip_id || ' has been completed. Distance: ' || ROUND(NEW.distance::numeric, 1) || ' km',
      'Success',
      'trip',
      NEW.trip_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
