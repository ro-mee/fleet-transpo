-- ============================================
-- MIGRATION 053: Driver Leave Request Improvements
--
-- 1. Add partial-day leave support (start_time, end_time) to driver_leave_requests
-- 2. Add driver_leave_balances table to track yearly allowances
-- 3. Add notification triggers for leave lifecycle events
-- ============================================

BEGIN;

-- 1. Partial-day support
ALTER TABLE driver_leave_requests
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME;

-- 2. Leave Balances Table
CREATE TABLE IF NOT EXISTS driver_leave_balances (
  balance_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  leave_type VARCHAR(50) NOT NULL,
  allocated_days NUMERIC NOT NULL DEFAULT 0,
  used_days NUMERIC NOT NULL DEFAULT 0,
  
  -- Each driver can have one balance record per leave type
  UNIQUE(driver_id, leave_type)
);

COMMENT ON TABLE driver_leave_balances IS
  'Tracks yearly leave allowances for drivers (e.g., Vacation, Sick Leave). used_days is incremented when a leave is Approved.';

CREATE INDEX IF NOT EXISTS idx_leave_balances_driver ON driver_leave_balances(driver_id);

ALTER TABLE driver_leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view driver leave balances"
  ON driver_leave_balances FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet manager can manage driver leave balances"
  ON driver_leave_balances FOR ALL
  USING (has_role(ARRAY['system_admin', 'fleet_manager']));


-- 3. Notification Triggers

-- Trigger: Notify Fleet Manager when a driver requests leave
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

DROP TRIGGER IF EXISTS trigger_notify_leave_requested ON driver_leave_requests;
CREATE TRIGGER trigger_notify_leave_requested
  AFTER INSERT ON driver_leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_leave_requested();


-- Trigger: Notify Driver when their leave is approved/declined
CREATE OR REPLACE FUNCTION notify_leave_reviewed()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status = 'Approved' OR NEW.status = 'Declined') AND OLD.status = 'Pending' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      d.employee_id,
      'Leave Request ' || NEW.status,
      'Your leave request from ' || NEW.start_date || ' to ' || NEW.end_date || ' was ' || LOWER(NEW.status) || '.',
      CASE WHEN NEW.status = 'Approved' THEN 'Success' ELSE 'Warning' END,
      'leave_request',
      NEW.leave_request_id
    FROM drivers d
    WHERE d.driver_id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_leave_reviewed ON driver_leave_requests;
CREATE TRIGGER trigger_notify_leave_reviewed
  AFTER UPDATE ON driver_leave_requests
  FOR EACH ROW
  WHEN ((NEW.status = 'Approved' OR NEW.status = 'Declined') AND OLD.status = 'Pending')
  EXECUTE FUNCTION notify_leave_reviewed();

COMMIT;
