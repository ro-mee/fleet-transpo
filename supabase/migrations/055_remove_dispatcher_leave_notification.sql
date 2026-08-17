-- ============================================
-- MIGRATION 055: Revert Dispatcher Leave Notifications
--
-- Reverts migration 054 by modifying the trigger function 
-- to notify ONLY fleet managers and admins when a driver 
-- requests leave, excluding dispatchers per business rules.
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
  WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
