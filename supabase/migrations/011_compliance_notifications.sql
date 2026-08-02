-- ============================================
-- MIGRATION 011: Compliance Notifications
--
-- Creates notifications when vehicle registration
-- or driver licenses become overdue. Duplicate-guarded
-- so repeated sync runs do not spam notifications.
-- ============================================

-- Vehicle registration overdue
CREATE OR REPLACE FUNCTION notify_registration_overdue()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.registration_expiry IS NOT NULL
     AND NEW.registration_expiry < CURRENT_DATE
     AND (OLD.registration_expiry IS NULL OR OLD.registration_expiry >= CURRENT_DATE)
     AND NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE reference_type = 'vehicle'
         AND reference_id = NEW.vehicle_id
         AND title = 'Registration Overdue'
     ) THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Registration Overdue',
      'Vehicle ' || COALESCE(NEW.plate_number, '#' || NEW.vehicle_id) || ' LTO registration expired on ' || NEW.registration_expiry || '. Renew immediately.',
      'Warning',
      'vehicle',
      NEW.vehicle_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_registration_overdue
  AFTER UPDATE OF registration_expiry ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION notify_registration_overdue();

-- Driver license expired
CREATE OR REPLACE FUNCTION notify_license_expired()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.license_expiry IS NOT NULL
     AND NEW.license_expiry < CURRENT_DATE
     AND (OLD.license_expiry IS NULL OR OLD.license_expiry >= CURRENT_DATE)
     AND NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE reference_type = 'driver'
         AND reference_id = NEW.driver_id
         AND title = 'License Expired'
     ) THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'License Expired',
      'Driver ' || e.first_name || ' ' || e.last_name || ' professional license expired on ' || NEW.license_expiry || '. Suspend until renewed.',
      'Warning',
      'driver',
      NEW.driver_id
    FROM employees e
    WHERE e.employee_id = NEW.employee_id;

    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'License Expired',
      'Driver license for driver #' || NEW.driver_id || ' expired on ' || NEW.license_expiry || '.',
      'Warning',
      'driver',
      NEW.driver_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_license_expired
  AFTER UPDATE OF license_expiry ON drivers
  FOR EACH ROW
  EXECUTE FUNCTION notify_license_expired();
