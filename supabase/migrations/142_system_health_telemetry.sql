BEGIN;

-- ============================================
-- MIGRATION 142: system health & reliability telemetry snapshots
--
-- Captures periodic health snapshots (availability %, latency, error counts,
-- active incidents, and subsystem JSON signals) for real historical telemetry.
-- ============================================

CREATE TABLE IF NOT EXISTS public.system_health_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  overall_status text NOT NULL CHECK (overall_status IN ('operational', 'attention', 'degraded', 'unknown')),
  availability_pct numeric(5,2) NOT NULL DEFAULT 100.00,
  db_latency_ms integer NOT NULL DEFAULT 0,
  app_errors_count integer NOT NULL DEFAULT 0,
  active_incidents_count integer NOT NULL DEFAULT 0,
  subsystems jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_health_snapshots_recorded_at
  ON public.system_health_snapshots (recorded_at DESC);

-- Enable RLS and revoke anon/authenticated privileges per repository security policy
ALTER TABLE public.system_health_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.system_health_snapshots FROM anon, authenticated;

COMMIT;
