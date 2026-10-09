-- CANDIDATE ONLY: do not apply until D01-D10 data/privacy/source approvals.
-- Runner owns the transaction. No operational source scopes are seeded.
CREATE TABLE IF NOT EXISTS public.request_cargo_manifest_revisions (
  request_cargo_manifest_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id integer NOT NULL REFERENCES public.transportation_requests(request_id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  source_system text NOT NULL CHECK (source_system IN ('PMS','POS')),
  source_organization_id text NOT NULL CHECK (length(btrim(source_organization_id)) BETWEEN 1 AND 128),
  source_external_request_id text NOT NULL CHECK (length(btrim(source_external_request_id)) BETWEEN 1 AND 255),
  source_event_id text NOT NULL CHECK (length(btrim(source_event_id)) BETWEEN 1 AND 255),
  manifest_snapshot jsonb NOT NULL CHECK ((jsonb_typeof(manifest_snapshot)='object'
    AND jsonb_typeof(manifest_snapshot->'lines')='array'
    AND jsonb_array_length(manifest_snapshot->'lines') BETWEEN 1 AND 500
    AND manifest_snapshot->'source_ref'->>'system' = source_system
    AND manifest_snapshot->'source_ref'->>'organization_id' = source_organization_id
    AND manifest_snapshot->'source_ref'->>'external_request_id' = source_external_request_id
    AND manifest_snapshot ?& ARRAY['source_ref','service_code','lines']) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,revision),
  UNIQUE(source_system,source_organization_id,source_event_id)
);
ALTER TABLE public.request_cargo_manifest_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.request_cargo_manifest_revisions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_request_cargo_manifest_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Cargo manifest revisions are immutable' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM public.transportation_requests r JOIN public.service_types s ON s.service_type_id=r.service_type_id
    WHERE r.request_id=NEW.request_id AND r.source_system=NEW.source_system
      AND r.external_request_id=NEW.source_external_request_id AND r.load_type='Cargo' AND r.deleted_at IS NULL
      AND s.service_code=NEW.manifest_snapshot->>'service_code'
      AND s.service_code IN ('RESTAURANT_SUPPLY_PICKUP','RESTAURANT_FOOD_DELIVERY','HOTEL_SUPPLY_TRANSFER') FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cargo manifest request identity mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS request_cargo_manifest_guard ON public.request_cargo_manifest_revisions;
CREATE TRIGGER request_cargo_manifest_guard BEFORE INSERT OR UPDATE OR DELETE ON public.request_cargo_manifest_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_cargo_manifest_revision();

CREATE OR REPLACE FUNCTION public.guard_request_cargo_source_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.source_system IS DISTINCT FROM OLD.source_system OR NEW.external_request_id IS DISTINCT FROM OLD.external_request_id
      OR NEW.load_type IS DISTINCT FROM OLD.load_type OR NEW.service_type_id IS DISTINCT FROM OLD.service_type_id)
     AND EXISTS (SELECT 1 FROM public.request_cargo_manifest_revisions WHERE request_id=OLD.request_id) THEN
    RAISE EXCEPTION 'Manifest-bound request source and service are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS request_cargo_source_identity_guard ON public.transportation_requests;
CREATE TRIGGER request_cargo_source_identity_guard BEFORE UPDATE ON public.transportation_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_cargo_source_identity();
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_request_cargo_manifest_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_request_cargo_source_identity() FROM PUBLIC, anon, authenticated;
