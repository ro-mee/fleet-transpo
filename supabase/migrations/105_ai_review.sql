-- ============================================
-- MIGRATION 105: ailogs review columns (acknowledge flow)
--
-- Same pattern as migration 104 (push_outbox): some AI failures are not
-- actionable from the dashboard (e.g. a stale provider model name that needs
-- a config change) — regenerating just fails again, yet the all-time health
-- counter would keep the AI row red forever. Marking such rows reviewed
-- keeps history intact with the reviewer's identity while health counts
-- unreviewed rows only. See POST /api/system/health/ai-review.
-- Idempotent: safe no-op when the columns already exist.
-- ============================================

ALTER TABLE ailogs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by integer NULL;

-- The health probe pattern: unreviewed errors, newest first.
CREATE INDEX IF NOT EXISTS idx_ailogs_unreviewed_errors
  ON ailogs (created_at DESC)
  WHERE status ILIKE 'error' AND reviewed_at IS NULL;
