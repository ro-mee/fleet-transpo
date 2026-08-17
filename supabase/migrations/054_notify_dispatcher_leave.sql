-- ============================================
-- MIGRATION 054: Include Dispatchers in Leave Notifications
--
-- Modifies the trigger function to notify dispatchers 
-- (in addition to fleet managers and admins) when a driver 
-- requests leave.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION notify_leave_requested()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    e.employee_id,
    'New Leave Request',
    'A driver has requested ' || NEW.leave_type || ' from ' || NEW.start_date || ' to ' || NEW.end_date || '.',
    'Info',
    'leave_request',
    NEW.leave_request_id
  FROM employees e
  WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin', 'dispatcher'));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
