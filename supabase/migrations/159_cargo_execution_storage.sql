-- CANDIDATE ONLY. D01-D10 remain pending. Do not apply or create a live bucket.
-- The runner owns the transaction; fixture tests rewrite both schema qualifiers.
CREATE TABLE IF NOT EXISTS public.cargo_trip_executions (
  execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id integer NOT NULL UNIQUE REFERENCES public.trips(trip_id) ON DELETE RESTRICT,
  request_manifest_id uuid REFERENCES public.request_cargo_manifest_revisions(request_cargo_manifest_revision_id) ON DELETE RESTRICT,
  supply_allocation_id uuid REFERENCES public.supply_dispatch_allocations(supply_dispatch_allocation_id) ON DELETE RESTRICT,
  manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(request_manifest_id,supply_allocation_id)=1)
);
CREATE TABLE IF NOT EXISTS public.cargo_receipts (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id) ON DELETE RESTRICT,
  execution_version integer NOT NULL CHECK(execution_version>0),
  stage text NOT NULL CHECK(stage IN ('PICKUP','DELIVERY')),
  manifest_ref jsonb NOT NULL,
  manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  submission_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 500),
  reporter_employee_id integer NOT NULL REFERENCES public.employees(employee_id),
  reporter_driver_id integer NOT NULL REFERENCES public.drivers(driver_id),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  receiver_confirmation_ref uuid,
  UNIQUE(execution_id,submission_id),
  UNIQUE(execution_id,execution_version),
  UNIQUE(receipt_id,execution_id),
  CHECK((payload->'manifest_ref'=manifest_ref AND manifest_ref->>'hash'=manifest_hash AND payload->'lines'=lines
    AND payload->>'stage'=stage AND payload->>'submission_id'=submission_id::text) IS TRUE)
);
CREATE TABLE IF NOT EXISTS public.cargo_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.cargo_receipts(receipt_id),
  execution_version integer NOT NULL CHECK(execution_version>0),
  action text NOT NULL CHECK(action IN ('WAIT','ACCEPT_OBSERVED','REJECT_PICKUP')),
  manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  source_system text NOT NULL CHECK(source_system IN ('PMS','POS','SCM')),
  source_organization_id text NOT NULL CHECK(length(btrim(source_organization_id)) BETWEEN 1 AND 128),
  principal_ref text NOT NULL CHECK(length(btrim(principal_ref)) BETWEEN 1 AND 255),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  event_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system,source_organization_id,event_id),
  UNIQUE(decision_id,receipt_id),
  CHECK((payload->>'receipt_id'=receipt_id::text AND payload->>'action'=action AND payload->>'manifest_hash'=manifest_hash
    AND payload->>'reason'=reason AND payload->>'event_id'=event_id::text) IS TRUE)
);
CREATE TABLE IF NOT EXISTS public.cargo_fleet_clearances (
  clearance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id),
  receipt_id uuid NOT NULL REFERENCES public.cargo_receipts(receipt_id),
  decision_id uuid,
  authorized_employee_id integer NOT NULL REFERENCES public.employees(employee_id),
  version integer NOT NULL CHECK(version>0),
  manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  safety_evidence_ref text CHECK(safety_evidence_ref IS NULL OR length(btrim(safety_evidence_ref)) BETWEEN 1 AND 255),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(decision_id,receipt_id) REFERENCES public.cargo_decisions(decision_id,receipt_id),
  FOREIGN KEY(receipt_id,execution_id) REFERENCES public.cargo_receipts(receipt_id,execution_id),
  UNIQUE(receipt_id,version)
);
CREATE TABLE IF NOT EXISTS public.cargo_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id),
  uploader_employee_id integer NOT NULL REFERENCES public.employees(employee_id),
  uploader_driver_id integer NOT NULL REFERENCES public.drivers(driver_id),
  submission_id uuid NOT NULL,
  bucket text NOT NULL DEFAULT 'cargo-evidence' CHECK(bucket='cargo-evidence'),
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 5242880),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'STAGED' CHECK(state IN ('STAGED','READY','ORPHANED','ATTACHED')),
  retention_state text NOT NULL DEFAULT 'AWAITING_APPROVED_POLICY' CHECK(retention_state='AWAITING_APPROVED_POLICY'),
  receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_id,execution_id) REFERENCES public.cargo_receipts(receipt_id,execution_id),
  UNIQUE(execution_id,uploader_employee_id,submission_id,content_hash),
  CHECK(object_key=execution_id::text||'/'||submission_id::text||'/'||evidence_id::text||CASE WHEN mime_type='image/jpeg' THEN '.jpg' ELSE '.png' END),
  CHECK((state='ATTACHED')=(receipt_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.cargo_feedback_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id),
  execution_version integer NOT NULL CHECK(execution_version>0),
  source_system text NOT NULL CHECK(source_system IN ('PMS','POS','SCM')),
  source_organization_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('PICKUP_RECORDED','DISCREPANCY_REPORTED','SOURCE_DECISION_RECORDED','DELIVERY_RECORDED','TRANSPORT_CLOSED')),
  receipt_id uuid,
  decision_id uuid,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACKNOWLEDGED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  acknowledgement jsonb,
  acknowledged_at timestamptz,
  last_error_code varchar(64) CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_id,execution_id) REFERENCES public.cargo_receipts(receipt_id,execution_id),
  FOREIGN KEY(decision_id,receipt_id) REFERENCES public.cargo_decisions(decision_id,receipt_id),
  UNIQUE NULLS NOT DISTINCT(execution_id,execution_version,event_type,receipt_id),
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK((event_type='SOURCE_DECISION_RECORDED')=(decision_id IS NOT NULL)),
  CHECK(event_type='TRANSPORT_CLOSED' OR receipt_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.cargo_decision_inbox (
  inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK(source_system IN ('PMS','POS','SCM')),
  source_organization_id text NOT NULL,
  event_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  receipt_id uuid NOT NULL REFERENCES public.cargo_receipts(receipt_id),
  actor_ref text NOT NULL,
  decision_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(decision_id,receipt_id) REFERENCES public.cargo_decisions(decision_id,receipt_id),
  UNIQUE(source_system,source_organization_id,event_id)
);

CREATE OR REPLACE FUNCTION public.guard_cargo_execution_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref jsonb; snapshot jsonb;
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (NEW.trip_id,NEW.request_manifest_id,NEW.supply_allocation_id,NEW.manifest,NEW.created_at)
    IS DISTINCT FROM (OLD.trip_id,OLD.request_manifest_id,OLD.supply_allocation_id,OLD.manifest,OLD.created_at)) THEN
    RAISE EXCEPTION 'Cargo execution identity is immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  IF NEW.request_manifest_id IS NOT NULL THEN
    SELECT jsonb_build_object('kind','REQUEST','id',m.request_cargo_manifest_revision_id,'revision',m.revision,'hash',m.manifest_hash), m.manifest_snapshot INTO ref,snapshot
      FROM public.trips t JOIN public.dispatchschedules d ON d.dispatch_id=t.dispatch_id
      JOIN public.request_cargo_manifest_revisions m ON m.request_id=d.request_id
      WHERE t.trip_id=NEW.trip_id AND m.request_cargo_manifest_revision_id=NEW.request_manifest_id AND d.service_type IS DISTINCT FROM 'SUPPLY_DELIVERY'
      AND NOT EXISTS(SELECT 1 FROM public.request_cargo_manifest_revisions newer WHERE newer.request_id=m.request_id AND newer.revision>m.revision)
      FOR UPDATE OF t,d;
    IF ref IS NULL OR (NEW.manifest IS DISTINCT FROM snapshot||jsonb_build_object('manifest_ref',ref)) THEN
      RAISE EXCEPTION 'Cargo request manifest does not belong to this trip' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT jsonb_build_object('kind','SUPPLY','id',m.supply_manifest_revision_id,'revision',m.manifest_revision,'hash',m.manifest_hash) INTO ref
      FROM public.trips t JOIN public.dispatchschedules d ON d.dispatch_id=t.dispatch_id
      JOIN public.supply_dispatch_allocations a ON a.dispatch_id=d.dispatch_id
      JOIN public.supply_manifest_revisions m ON m.supply_shipment_id=a.supply_shipment_id AND m.manifest_revision=a.manifest_revision
      WHERE t.trip_id=NEW.trip_id AND d.request_id IS NULL AND d.service_type='SUPPLY_DELIVERY'
        AND a.supply_dispatch_allocation_id=NEW.supply_allocation_id AND a.allocation_status='ASSIGNED' FOR UPDATE OF t,d,a;
    IF ref IS NULL OR NEW.manifest->'manifest_ref' IS DISTINCT FROM ref THEN
      RAISE EXCEPTION 'Cargo supply allocation does not belong to this trip' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_execution_binding ON public.cargo_trip_executions;
CREATE TRIGGER cargo_execution_binding BEFORE INSERT OR UPDATE OR DELETE ON public.cargo_trip_executions FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_execution_binding();

-- Parent linkage cannot silently invalidate immutable cargo identity. Task 6
-- owns any explicit custody/rescheduling workflow that may supersede this hold.
CREATE OR REPLACE FUNCTION public.guard_cargo_parent_linkage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='trips' THEN
    IF NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id AND EXISTS(SELECT 1 FROM public.cargo_trip_executions WHERE trip_id=OLD.trip_id) THEN
      RAISE EXCEPTION 'Cargo trip linkage is locked' USING ERRCODE='55000'; END IF;
  ELSIF TG_TABLE_NAME='dispatchschedules' THEN
    IF (NEW.request_id,NEW.service_type) IS DISTINCT FROM (OLD.request_id,OLD.service_type)
      AND EXISTS(SELECT 1 FROM public.cargo_trip_executions e JOIN public.trips t USING(trip_id) WHERE t.dispatch_id=OLD.dispatch_id) THEN
      RAISE EXCEPTION 'Cargo dispatch linkage is locked' USING ERRCODE='55000'; END IF;
  ELSE
    IF (NEW.dispatch_id,NEW.supply_shipment_id,NEW.manifest_revision,NEW.allocation_status)
      IS DISTINCT FROM (OLD.dispatch_id,OLD.supply_shipment_id,OLD.manifest_revision,OLD.allocation_status)
      AND EXISTS(SELECT 1 FROM public.cargo_trip_executions WHERE supply_allocation_id=OLD.supply_dispatch_allocation_id) THEN
      RAISE EXCEPTION 'Cargo allocation linkage is locked' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_trip_linkage ON public.trips;
CREATE TRIGGER cargo_trip_linkage BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_parent_linkage();
DROP TRIGGER IF EXISTS cargo_dispatch_linkage ON public.dispatchschedules;
CREATE TRIGGER cargo_dispatch_linkage BEFORE UPDATE ON public.dispatchschedules FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_parent_linkage();
DROP TRIGGER IF EXISTS cargo_allocation_linkage ON public.supply_dispatch_allocations;
CREATE TRIGGER cargo_allocation_linkage BEFORE UPDATE ON public.supply_dispatch_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_parent_linkage();

CREATE OR REPLACE FUNCTION public.guard_cargo_clearance_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.cargo_trip_executions e JOIN public.cargo_receipts r USING(execution_id)
    WHERE e.execution_id=NEW.execution_id AND e.version=NEW.version AND r.receipt_id=NEW.receipt_id
      AND r.manifest_hash=NEW.manifest_hash AND e.manifest->'manifest_ref'->>'hash'=NEW.manifest_hash
      AND NOT EXISTS(SELECT 1 FROM public.cargo_receipts newer WHERE newer.execution_id=r.execution_id AND newer.stage=r.stage AND newer.execution_version>r.execution_version)
      AND NEW.decision_id IS NOT DISTINCT FROM (SELECT d.decision_id FROM public.cargo_decisions d WHERE d.receipt_id=r.receipt_id ORDER BY d.execution_version DESC LIMIT 1)
      FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale cargo clearance binding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_clearance_binding ON public.cargo_fleet_clearances;
CREATE TRIGGER cargo_clearance_binding BEFORE INSERT ON public.cargo_fleet_clearances FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_clearance_binding();

CREATE OR REPLACE FUNCTION public.guard_cargo_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cargo history is immutable' USING ERRCODE='55000'; END $$;
DROP TRIGGER IF EXISTS cargo_receipt_immutable ON public.cargo_receipts;
CREATE TRIGGER cargo_receipt_immutable BEFORE UPDATE OR DELETE ON public.cargo_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();
DROP TRIGGER IF EXISTS cargo_decision_immutable ON public.cargo_decisions;
CREATE TRIGGER cargo_decision_immutable BEFORE UPDATE OR DELETE ON public.cargo_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();
DROP TRIGGER IF EXISTS cargo_inbox_immutable ON public.cargo_decision_inbox;
CREATE TRIGGER cargo_inbox_immutable BEFORE UPDATE OR DELETE ON public.cargo_decision_inbox FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();
DROP TRIGGER IF EXISTS cargo_clearance_immutable ON public.cargo_fleet_clearances;
CREATE TRIGGER cargo_clearance_immutable BEFORE UPDATE OR DELETE ON public.cargo_fleet_clearances FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();

CREATE OR REPLACE FUNCTION public.guard_cargo_record_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bound public.cargo_trip_executions;
BEGIN
  IF TG_TABLE_NAME='cargo_receipts' THEN
    SELECT * INTO bound FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
    IF bound.execution_id IS NULL OR NEW.execution_version<>bound.version+1 OR NEW.manifest_ref IS DISTINCT FROM bound.manifest->'manifest_ref' THEN
      RAISE EXCEPTION 'Receipt manifest mismatch' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM public.trips t JOIN public.drivers d ON d.driver_id=t.driver_id WHERE t.trip_id=bound.trip_id
      AND d.driver_id=NEW.reporter_driver_id AND d.employee_id=NEW.reporter_employee_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt reporter mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT e.* INTO bound FROM public.cargo_receipts r JOIN public.cargo_trip_executions e USING(execution_id)
      WHERE r.receipt_id=NEW.receipt_id AND r.manifest_hash=NEW.manifest_hash;
    IF bound.execution_id IS NULL OR NEW.execution_version<>bound.version+1 OR NEW.source_system IS DISTINCT FROM bound.manifest->'source_ref'->>'system'
      OR NEW.source_organization_id IS DISTINCT FROM bound.manifest->'source_ref'->>'organization_id' THEN
      RAISE EXCEPTION 'Decision source or manifest mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_receipt_binding ON public.cargo_receipts;
CREATE TRIGGER cargo_receipt_binding BEFORE INSERT ON public.cargo_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_record_binding();
DROP TRIGGER IF EXISTS cargo_decision_binding ON public.cargo_decisions;
CREATE TRIGGER cargo_decision_binding BEFORE INSERT ON public.cargo_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_record_binding();

CREATE OR REPLACE FUNCTION public.guard_cargo_outbox_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','attempts','next_attempt_at','lease_token','lease_expires_at','acknowledgement','acknowledged_at','last_error_code'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','next_attempt_at','lease_token','lease_expires_at','acknowledgement','acknowledged_at','last_error_code']) THEN
    RAISE EXCEPTION 'Cargo event identity is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_outbox_identity ON public.cargo_feedback_outbox;
CREATE TRIGGER cargo_outbox_identity BEFORE UPDATE OR DELETE ON public.cargo_feedback_outbox FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_outbox_identity();

CREATE OR REPLACE FUNCTION public.guard_cargo_evidence_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','receipt_id','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','receipt_id','updated_at'])
    OR OLD.state='ATTACHED' THEN RAISE EXCEPTION 'Cargo evidence identity is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.receipt_id IS NOT NULL THEN
    PERFORM 1 FROM public.cargo_receipts r WHERE r.receipt_id=NEW.receipt_id AND r.execution_id=NEW.execution_id
      AND r.submission_id=NEW.submission_id AND r.reporter_employee_id=NEW.uploader_employee_id AND r.reporter_driver_id=NEW.uploader_driver_id;
    IF NOT FOUND OR OLD.state<>'READY' THEN RAISE EXCEPTION 'Evidence attachment mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_evidence_identity ON public.cargo_evidence;
CREATE TRIGGER cargo_evidence_identity BEFORE UPDATE OR DELETE ON public.cargo_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_evidence_identity();

ALTER TABLE public.cargo_trip_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_fleet_clearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_feedback_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_decision_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_trip_executions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_fleet_clearances FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_feedback_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_decision_inbox FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_execution_binding() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_record_binding() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_outbox_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_evidence_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_parent_linkage() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_clearance_binding() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('cargo-evidence','cargo-evidence',false,5242880,ARRAY['image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
-- Restrictive policies fence this bucket even if another permissive storage policy exists.
DROP POLICY IF EXISTS cargo_evidence_deny_clients ON storage.objects;
CREATE POLICY cargo_evidence_deny_clients ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(bucket_id<>'cargo-evidence') WITH CHECK(bucket_id<>'cargo-evidence');
