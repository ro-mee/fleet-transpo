-- ============================================
-- NOTIFICATION TRIGGERS
-- Automatically create notifications on key events
-- ============================================

-- Reservation approved
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

CREATE TRIGGER trigger_notify_reservation_approved
  AFTER UPDATE ON vehiclereservations
  FOR EACH ROW
  WHEN (NEW.status = 'Approved' AND OLD.status = 'Pending')
  EXECUTE FUNCTION notify_reservation_approved();

-- Dispatch created
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

CREATE TRIGGER trigger_notify_dispatch_created
  AFTER INSERT ON dispatchschedules
  FOR EACH ROW
  EXECUTE FUNCTION notify_dispatch_created();

-- Maintenance due reminder
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

CREATE TRIGGER trigger_notify_maintenance_due
  AFTER INSERT OR UPDATE ON vehiclemaintenance
  FOR EACH ROW
  EXECUTE FUNCTION notify_maintenance_due();

-- Trip completed
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

CREATE TRIGGER trigger_notify_trip_completed
  AFTER UPDATE ON trips
  FOR EACH ROW
  WHEN (NEW.trip_status = 'Completed' AND OLD.trip_status != 'Completed')
  EXECUTE FUNCTION notify_trip_completed();

-- Document expiring soon
CREATE OR REPLACE FUNCTION notify_document_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND NEW.expiry_date > CURRENT_DATE THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Document Expiring Soon',
      NEW.document_type || ' for vehicle #' || NEW.vehicle_id || ' expires on ' || NEW.expiry_date,
      'Warning',
      'document',
      NEW.document_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_document_expiry
  AFTER INSERT OR UPDATE ON vehicledocuments
  FOR EACH ROW
  EXECUTE FUNCTION notify_document_expiry();
