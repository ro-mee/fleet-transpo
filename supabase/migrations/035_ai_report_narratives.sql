-- ============================================
-- MIGRATION 035: AI Report Narrative Budget Table
--
-- Persists the AI Analyst report narratives (Tier 1) so the "once a day per
-- report + range" cache and the "3 regenerations per day per report tab" budget
-- survive a server restart (Vercel cold start / dev reload). Previously these
-- lived in server memory and were wiped on every restart, re-billing an LLM call
-- and resetting the quota.
--
-- One row per (report, range_from, range_to) via the UNIQUE key:
--   - narrative / actions / flag / mode = the durable "sticky note" the client
--     re-reads instead of re-charging the LLM within 24h (generated_at).
--   - force_count + force_day          = the per-tab 3/day regenerate budget.
--     force_count applies to a calendar day (force_day); when the day rolls
--     over it resets to 0 lazily on the next regenerate.
--
-- RLS is enabled but inert (app-layer auth), consistent with every other table.
-- Row count is bounded (a small number of report x range combos), so no cleanup
-- sweep is required.
--
-- House convention: guarded CREATE TABLE/INDEX; bare CREATE POLICY.
-- ============================================
BEGIN;

CREATE TABLE IF NOT EXISTS ai_report_narratives (
  id            SERIAL PRIMARY KEY,
  report        VARCHAR(20) NOT NULL,
  range_from    VARCHAR(30),
  range_to      VARCHAR(30),
  mode          VARCHAR(20) NOT NULL DEFAULT 'deterministic',
  narrative     TEXT,
  actions       JSONB,
  flag          VARCHAR(10) NOT NULL DEFAULT 'success',
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_force_at TIMESTAMPTZ,
  force_count   INTEGER NOT NULL DEFAULT 0,
  force_day     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One durable sticky note per (report, range); CONFLICT target for upserts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_report_narrative_key
  ON ai_report_narratives (report, COALESCE(range_from, '*'), COALESCE(range_to, '*'));

-- Cheap lookup for daily-budget resets and freshness sweeps.
CREATE INDEX IF NOT EXISTS idx_ai_report_narrative_force_day
  ON ai_report_narratives (force_day);

ALTER TABLE ai_report_narratives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view AI report narratives"
  ON ai_report_narratives FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage AI report narratives"
  ON ai_report_narratives FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'management']));

COMMIT;