-- Device push tokens for real (server-sent) push notifications.
--
-- The mobile app registers an Expo push token per install; the server reads the
-- active tokens for the employees a notification targets and sends through
-- Expo Push Service, so an alert reaches the OS even when the app is killed.
-- The notifications table stays the source of truth; these tokens are only the
-- delivery addresses. Tokens are deactivated (not deleted) on logout and when
-- Expo reports DeviceNotRegistered.

CREATE TABLE IF NOT EXISTS device_tokens (
  device_token_id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(employee_id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform VARCHAR(20) NOT NULL DEFAULT 'android',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_device_tokens_employee_active'
  ) THEN
    CREATE INDEX idx_device_tokens_employee_active ON device_tokens(employee_id) WHERE active;
  END IF;
END $$;

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- A user may only manage tokens registered to their own employee account.
-- The server send path bypasses RLS (it connects as the service role), so it
-- can still read every active token.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_tokens'
      AND policyname = 'Users can manage own device tokens'
  ) THEN
    CREATE POLICY "Users can manage own device tokens"
      ON device_tokens FOR ALL
      USING (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()))
      WITH CHECK (employee_id = (SELECT employee_id FROM employees WHERE user_id = auth.uid()));
  END IF;
END $$;