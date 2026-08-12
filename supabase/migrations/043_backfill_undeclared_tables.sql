-- ============================================
-- MIGRATION 034: Backfill undeclared tables
--
-- Purpose:
--   Four tables exist on the live database
--   (dnxuphhxlzidvwtdqqkq) but no migration ever
--   declared them, so replaying migrations onto an
--   empty database produced a schema the app
--   cannot run against. One (ailogs) was created
--   by runtime `CREATE TABLE IF NOT EXISTS` calls
--   in request handlers; the other three were
--   applied by hand and never written down.
--
--   Definitions below are transcribed from the
--   live schema (scripts/dump-schema.mjs), not
--   from the runtime DDL, because the two had
--   drifted.
--
-- Idempotent: every statement is IF NOT EXISTS,
-- so this is a no-op against the live DB and a
-- real create on a fresh one.
-- ============================================

BEGIN;

-- --------------------------------------------
-- ailogs — AI request/token/latency log.
-- Was created at runtime by src/lib/ai/logger.js
-- and src/app/api/ai/logs/route.js on every call;
-- those DDL blocks are removed in this change.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ailogs (
  log_id            SERIAL PRIMARY KEY,
  feature_used      VARCHAR(50) NOT NULL,
  provider_name     VARCHAR(50),
  model_name        VARCHAR(100),
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  duration_ms       INTEGER DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'Success',
  error_message     TEXT,
  user_email        VARCHAR(255),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------
-- ai_report_narratives — cached LLM narrative per
-- report + date range, with a per-day force quota.
-- --------------------------------------------
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

-- COALESCE keys so one NULL-ranged row per report
-- cannot be duplicated (NULLs are distinct in a
-- plain unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_report_narrative_key
  ON ai_report_narratives (
    report,
    COALESCE(range_from, '*'),
    COALESCE(range_to, '*')
  );

CREATE INDEX IF NOT EXISTS idx_ai_report_narrative_force_day
  ON ai_report_narratives (force_day);

-- --------------------------------------------
-- system_settings — key/value app configuration.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_by    INTEGER
);

-- --------------------------------------------
-- substitute_vehicle_schedules — temporary driver
-- cover for a vehicle over a date range.
--
-- No code in src/ or mobile/ references this table
-- and the Roadmap proposes dropping it, but it
-- holds 1 live row, so it is declared here rather
-- than dropped. Dropping it is a separate,
-- destructive decision that needs a look at that
-- row first. -> Capstone/07 - Development/Open Questions.md
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS substitute_vehicle_schedules (
  substitute_id        SERIAL PRIMARY KEY,
  vehicle_id           INTEGER NOT NULL
                         REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  substitute_driver_id INTEGER NOT NULL
                         REFERENCES drivers(driver_id) ON DELETE CASCADE,
  effective_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until      DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           INTEGER REFERENCES employees(employee_id),
  updated_by           INTEGER REFERENCES employees(employee_id),
  CONSTRAINT chk_sub_interval
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

-- One open (no end date) substitution per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_open_vehicle
  ON substitute_vehicle_schedules (vehicle_id)
  WHERE effective_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_sub_vehicle_range
  ON substitute_vehicle_schedules (vehicle_id, effective_from, effective_until);

CREATE INDEX IF NOT EXISTS idx_sub_vehicle_history
  ON substitute_vehicle_schedules (vehicle_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_sub_driver
  ON substitute_vehicle_schedules (substitute_driver_id, effective_from DESC);

COMMIT;
