-- Canonical per-item provenance lives on the existing order, preserving its unique original source.
ALTER TABLE public.vehiclemaintenance ADD COLUMN IF NOT EXISTS inspection_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vehiclemaintenance ADD COLUMN IF NOT EXISTS inspection_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS public.maintenance_forecast_snapshots (
 snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id integer NOT NULL REFERENCES public.vehicles(vehicle_id),
 service_plan_id integer REFERENCES public.vehicle_service_plans(plan_id),
 maintenance_id integer REFERENCES public.vehiclemaintenance(maintenance_id),
 rule_version text NOT NULL,
 event text NOT NULL CHECK(event IN ('reviewed_schedule','inspection_reviewed','mechanic_outcome','completed','threshold_observed')),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 captured_by integer REFERENCES public.employees(employee_id),
 inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
 forecast jsonb NOT NULL DEFAULT '{}'::jsonb,
 outcome jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.maintenance_forecast_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.maintenance_forecast_snapshots FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.maintenance_forecast_snapshots_snapshot_id_seq FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_maintenance_forecast_order ON public.maintenance_forecast_snapshots(maintenance_id,snapshot_id);
CREATE OR REPLACE FUNCTION public.maintenance_forecast_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Maintenance forecast evidence is immutable'; END;
$$;
DROP TRIGGER IF EXISTS trg_maintenance_forecast_immutable ON public.maintenance_forecast_snapshots;
CREATE TRIGGER trg_maintenance_forecast_immutable BEFORE UPDATE OR DELETE ON public.maintenance_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION public.maintenance_forecast_immutable();
