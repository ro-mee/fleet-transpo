-- ============================================
-- MIGRATION 089: web session idle timeout policy
-- ============================================

ALTER TABLE web_sessions
  ADD COLUMN IF NOT EXISTS idle_timeout_seconds INTEGER NOT NULL DEFAULT 3600;
