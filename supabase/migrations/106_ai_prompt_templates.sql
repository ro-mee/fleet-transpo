-- ============================================
-- MIGRATION 106: ai_prompt_templates — DB-backed prompt overrides
--
-- Prompt markdown edited in the AI Providers UI must survive Vercel
-- redeploys and work across scaled function instances, so the database —
-- not the ephemeral runtime filesystem — is the source of truth for live
-- edits. Bundled resources/ai/*.md files remain the defaults, the
-- disaster fallback, and the seed/reset source (see prompt-loader.js).
--
-- No foreign key on updated_by: settings writes must never fail on
-- referential integrity. Idempotent: safe no-op when the table exists.
-- ============================================

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  prompt_key text PRIMARY KEY,
  content text NOT NULL,
  updated_by integer NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
