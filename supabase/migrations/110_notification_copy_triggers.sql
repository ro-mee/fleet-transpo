-- 110: Driver notification microcopy for the two trigger-composed producers.
--
-- All JS-produced driver notification copy now lives in
-- src/lib/notifications/copy.js (see the Notifications vault note). These two
-- producers compose their wording inside plpgsql triggers, so their copy
-- necessarily lives here — keep it in sync with the tone rules in that
-- module's header when editing: what happened + who + what happens next,
-- no staff jargon, no raw ids as the lead.
--
-- Idempotent: CREATE OR REPLACE only; triggers already exist (059 / 053).

BEGIN;

-- 1. Dispatch Assigned (from 059): "You have been assigned to dispatch
--    DSP-X." says what happened but not what to do next.
CREATE OR REPLACE FUNCTION notify_dispatch_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have a new dispatch (' || NEW.dispatch_number || '). Open the app for pickup time, guest, and route details.',
    'Alert',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION enqueue_dispatch_push()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have a new dispatch (' || NEW.dispatch_number || '). Open the app for pickup time, guest, and route details.',
    'default',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Leave Reviewed (from 053): the raw start/end date concatenation reads
--    like a database row in a push notification; the dates live in the app's
--    leave detail screen.
CREATE OR REPLACE FUNCTION notify_leave_reviewed()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status = 'Approved' OR NEW.status = 'Declined') AND OLD.status = 'Pending' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      d.employee_id,
      'Leave Request ' || NEW.status,
      CASE WHEN NEW.status = 'Approved'
        THEN 'Your leave request was approved. Check the app for the approved dates.'
        ELSE 'Your leave request was declined. Check the app for details or talk to your fleet manager.'
      END,
      CASE WHEN NEW.status = 'Approved' THEN 'Success' ELSE 'Warning' END,
      'leave_request',
      NEW.leave_request_id
    FROM drivers d
    WHERE d.driver_id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
