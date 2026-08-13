-- 031_perf_ai_provider_and_board_index
--
-- Two performance/schema fixes:
--   1. aiproviders was only ever created ad-hoc by a CREATE TABLE IF NOT EXISTS
--      that ran on every LLM call (a DDL round-trip on the hot path). Give it a
--      proper idempotent migration so the per-request DDL can be removed.
--   2. The dispatch board polls ORDER BY scheduled_departure ... WHERE
--      deleted_at IS NULL. A partial index matches that exact shape, so the
--      most-published query stops doing a full table scan as the fleet grows.

CREATE TABLE IF NOT EXISTS aiproviders (
  provider_id SERIAL PRIMARY KEY,
  provider_name VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  base_url VARCHAR(255),
  api_key TEXT,
  model_name VARCHAR(100) NOT NULL,
  temperature DECIMAL(3,2) DEFAULT 0.70,
  max_tokens INT DEFAULT 1500,
  timeout_ms INT DEFAULT 10000,
  is_enabled BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  custom_headers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_active_departure
  ON dispatchschedules (scheduled_departure)
  WHERE deleted_at IS NULL;
