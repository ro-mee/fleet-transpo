-- ============================================
-- 059 DISPATCH PUSH OUTBOX
-- Route DB-trigger-created notifications (which bypass the API's sendPush)
-- through a push outbox so an assigned driver still gets a real OS push.
-- Realizes ADR-005's documented outbox pattern.
-- ============================================

-- 1. Outbox table (server-only; no client policies needed, service role bypasses RLS).
CREATE TABLE IF NOT EXISTS push_outbox (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INTEGER      NOT NULL,
  title           TEXT         NOT NULL,
  body            TEXT         NOT NULL,
  channel_id      TEXT         NOT NULL DEFAULT 'default',
  reference_type  TEXT,
  reference_id    INTEGER,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'error')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_outbox_pending
  ON push_outbox (status, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_push_outbox_employee
  ON push_outbox (employee_id, status);

-- 2. Mark server-pushed notifications so the mobile feed can avoid a
--    double notification (server push + the feed's local fallback).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

-- 3. Dispatch-assigned is important enough to be a loud push: escalate the
--    trigger notification from 'Info' to 'Alert' (PUSH tier) so the mobile
--    feed shows it as urgent and the badge reflects it.
CREATE OR REPLACE FUNCTION notify_dispatch_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have been assigned to dispatch ' || NEW.dispatch_number || '.',
    'Alert',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enqueue a loud push for the assigned driver. Runs in the same statement
--    as the notify trigger but is deliberately order-independent: it carries
--    its own title/body and resolves the driver's employee_id itself.
CREATE OR REPLACE FUNCTION enqueue_dispatch_push()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have been assigned to dispatch ' || NEW.dispatch_number || '.',
    'default',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_enqueue_dispatch_push ON dispatchschedules;
CREATE TRIGGER trigger_enqueue_dispatch_push
  AFTER INSERT ON dispatchschedules
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_dispatch_push();