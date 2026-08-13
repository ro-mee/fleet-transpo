-- ============================================
-- MIGRATION 030: Notification Preferences
--
-- Persists per-user notification channel toggles for the Notification
-- Preferences screen (/notifications/preferences). Before this migration the
-- preferences page was a purely local-React-state mock: toggles reset on every
-- reload and nothing was written to the database. This table makes the toggles
-- durable and is the store the GET/PUT /api/notifications/preferences route
-- reads and writes.
--
-- Design notes:
--   * Identity is employee_id (absent NULL), matching every other notification
--     row. The web app and mobile bearer tokens both resolve to an
--     employee_id; the notifications.user_id column is unused by all producers.
--   * One row per (employee, event, channel). Absent rows mean "use the
--     server-side default" (in_app true, email/push false) so the GET route can
--     merge defaults without backfilling.
--   * channel is restricted to the three NOTIFICATION_CHANNELS values. email
--     and push delivery are not implemented yet — the toggles persist so the
--     preference is honored when those channels ship.
-- ============================================

BEGIN;

-- ============================================
-- 1. CREATE notification_preferences TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  event_key VARCHAR(60) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app', 'email', 'push')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, event_key, channel)
);

COMMENT ON TABLE notification_preferences IS
  'Per-employee notification channel toggles keyed by event type. Absent rows inherit the application default.';

COMMENT ON COLUMN notification_preferences.event_key IS
  'Notification event name, e.g. dispatch_created. Validated against the application event list (src/lib/constants.js NOTIFICATION_EVENTS).';

COMMENT ON COLUMN notification_preferences.channel IS
  'Delivery channel: in_app (live), email/push (accepted now, delivery ships later).';

-- Fast lookups: a user's whole preference map and the admin/user-management
-- per-employee view.
CREATE INDEX IF NOT EXISTS idx_notification_preferences_employee
  ON notification_preferences(employee_id);

-- ============================================
-- 2. RLS POLICIES
--    Mirrors the self-access pattern from migration 006/017: a user manages
--    only their own rows; staff may read any for administration. Server routes
--    run against the service role, so enforcement happens in the route code —
--    RLS here is defense-in-depth for direct-key usage, consistent with the
--    rest of the repo.
-- ============================================

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own preferences.
CREATE POLICY "Users can view own notification preferences"
  ON notification_preferences FOR SELECT
  USING (
    employee_id IN (
      SELECT e.employee_id FROM employees e
      WHERE e.user_id = auth.uid()
    )
  );

-- Users can update their own preferences (the PUT route upserts).
CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT e.employee_id FROM employees e
      WHERE e.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own notification preferences rows"
  ON notification_preferences FOR UPDATE
  USING (
    employee_id IN (
      SELECT e.employee_id FROM employees e
      WHERE e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    employee_id IN (
      SELECT e.employee_id FROM employees e
      WHERE e.user_id = auth.uid()
    )
  );

-- Staff with operations/admin roles can read any employee's preferences.
CREATE POLICY "Staff can view notification preferences"
  ON notification_preferences FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management', 'dispatcher']));

COMMIT;