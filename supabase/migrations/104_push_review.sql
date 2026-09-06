-- ============================================
-- MIGRATION 104: push_outbox review columns (acknowledge flow)
--
-- Some push failures are permanently undeliverable (e.g. the driver never
-- registered a device token) — retry can never fix them, yet the health
-- probe counts all-time errors, so the Push row would stay red forever.
-- The acknowledge flow marks such rows reviewed instead of deleting them:
-- history is preserved, the reporter's identity is kept, and health counts
-- only unreviewed rows. See POST /api/system/health/push-review.
-- Idempotent: safe no-op when the columns already exist.
-- ============================================

ALTER TABLE push_outbox
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by integer NULL;

-- The health probe pattern: unreviewed errors, newest first.
CREATE INDEX IF NOT EXISTS idx_push_outbox_unreviewed_errors
  ON push_outbox (created_at DESC)
  WHERE status = 'error' AND reviewed_at IS NULL;
