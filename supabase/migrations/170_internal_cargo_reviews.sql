-- Standalone INTERNAL work only; external providers and source credentials stay closed.
ALTER TABLE public.request_cargo_manifest_revisions DROP CONSTRAINT IF EXISTS request_cargo_manifest_revisions_source_system_check;
ALTER TABLE public.request_cargo_manifest_revisions ADD CONSTRAINT request_cargo_manifest_revisions_source_system_check CHECK(source_system IN ('PMS','POS','INTERNAL'));
ALTER TABLE public.cargo_decisions DROP CONSTRAINT IF EXISTS cargo_decisions_source_system_check;
ALTER TABLE public.cargo_decisions ADD CONSTRAINT cargo_decisions_source_system_check CHECK(source_system IN ('PMS','POS','SCM','INTERNAL'));
ALTER TABLE public.cargo_decision_inbox DROP CONSTRAINT IF EXISTS cargo_decision_inbox_source_system_check;
ALTER TABLE public.cargo_decision_inbox ADD CONSTRAINT cargo_decision_inbox_source_system_check CHECK(source_system IN ('PMS','POS','SCM','INTERNAL'));
ALTER TABLE public.cargo_evidence DROP CONSTRAINT IF EXISTS cargo_evidence_retention_state_check;
ALTER TABLE public.cargo_evidence ADD CONSTRAINT cargo_evidence_retention_state_check CHECK(retention_state IN ('AWAITING_APPROVED_POLICY','INTERNAL_PRESERVE'));

CREATE TABLE IF NOT EXISTS public.cargo_internal_reviews (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.cargo_receipts(receipt_id) ON DELETE RESTRICT,
  manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  submission_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  command_payload jsonb NOT NULL,
  kind text NOT NULL CHECK(kind IN ('SOURCE','SECUREMENT','RECEIVER')),
  action text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  reviewer_employee_id integer NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  execution_version integer NOT NULL CHECK(execution_version > 1),
  driver_id integer NOT NULL REFERENCES public.drivers(driver_id) ON DELETE RESTRICT,
  vehicle_id integer NOT NULL REFERENCES public.vehicles(vehicle_id) ON DELETE RESTRICT,
  reviewed_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  securement_checks jsonb,
  decision_id uuid REFERENCES public.cargo_decisions(decision_id) ON DELETE RESTRICT,
  clearance_id uuid REFERENCES public.cargo_fleet_clearances(clearance_id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id,submission_id),
  UNIQUE(execution_id,execution_version),
  CHECK((kind='SOURCE' AND action IN ('ACCEPT_OBSERVED','WAIT','REJECT_PICKUP')) OR (kind='SECUREMENT' AND action IN ('CLEAR','WAIT')) OR (kind='RECEIVER' AND action IN ('ACCEPT_DELIVERY','WAIT'))),
  CHECK((kind='SOURCE')=(decision_id IS NOT NULL)),
  CHECK((kind='SECUREMENT' AND action='CLEAR')=(clearance_id IS NOT NULL)),
  CHECK(action<>'CLEAR' OR (securement_checks @> '{"load_secured":true,"vehicle_safe":true,"counts_reviewed":true}') IS TRUE)
);
ALTER TABLE public.cargo_internal_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_internal_reviews FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_cargo_internal_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.cargo_trip_executions; r public.cargo_receipts; d public.cargo_decisions; c public.cargo_fleet_clearances;
BEGIN
  SELECT * INTO e FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
  SELECT * INTO r FROM public.cargo_receipts WHERE receipt_id=NEW.receipt_id;
  IF (e.manifest->'source_ref'->>'system'='INTERNAL' AND e.version=NEW.execution_version
    AND r.execution_id=e.execution_id AND r.manifest_hash=NEW.manifest_hash
    AND NEW.manifest_hash=e.manifest->'manifest_ref'->>'hash'
    AND r.stage=CASE NEW.kind WHEN 'RECEIVER' THEN 'DELIVERY' ELSE 'PICKUP' END
    AND NEW.command_payload->>'submission_id'=NEW.submission_id::text
    AND NEW.command_payload->>'receipt_id'=NEW.receipt_id::text
    AND NEW.command_payload->>'kind'=NEW.kind AND NEW.command_payload->>'action'=NEW.action
    AND NEW.command_payload->>'reason'=NEW.reason
    AND COALESCE(NEW.command_payload->'securement_checks','null'::jsonb) IS NOT DISTINCT FROM NEW.securement_checks
    AND (NEW.command_payload->>'expected_version')::integer=NEW.execution_version-1
    AND NEW.command_payload->'reviewed_evidence_ids'=to_jsonb(NEW.reviewed_evidence_ids)
    AND NOT EXISTS(SELECT 1 FROM public.cargo_receipts newer WHERE newer.execution_id=e.execution_id AND newer.stage=r.stage AND newer.execution_version>r.execution_version)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Internal cargo review binding mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.trips t JOIN public.employees emp ON emp.employee_id=NEW.reviewer_employee_id
    JOIN public.roles ro ON ro.role_id=emp.role_id
    WHERE t.trip_id=e.trip_id AND t.driver_id=NEW.driver_id AND t.vehicle_id=NEW.vehicle_id
      AND t.deleted_at IS NULL AND emp.deleted_at IS NULL AND emp.status='Active'
      AND ro.role_name IN ('fleet_manager','admin','super_admin')
      AND (CASE NEW.kind WHEN 'RECEIVER' THEN t.trip_status IN ('Drop-off','Arrived') ELSE t.trip_status IN ('Trip Started','At Pickup') END);
  IF NOT FOUND THEN RAISE EXCEPTION 'Internal cargo review authority mismatch' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.reviewed_evidence_ids)<>(SELECT count(DISTINCT id) FROM unnest(NEW.reviewed_evidence_ids) id)
    OR EXISTS(SELECT 1 FROM unnest(NEW.reviewed_evidence_ids) id WHERE NOT EXISTS(
      SELECT 1 FROM public.cargo_evidence photo WHERE photo.evidence_id=id AND photo.execution_id=e.execution_id
        AND photo.receipt_id=r.receipt_id AND photo.state='ATTACHED'))
    OR (NEW.action<>'WAIT' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.lines) line
      CROSS JOIN LATERAL jsonb_array_elements_text(line->'evidence_ids') evidence_id
      WHERE NOT (evidence_id::uuid=ANY(NEW.reviewed_evidence_ids)))) THEN
    RAISE EXCEPTION 'Internal cargo evidence review mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='SOURCE' THEN
    SELECT * INTO d FROM public.cargo_decisions WHERE decision_id=NEW.decision_id;
    IF (d.receipt_id=NEW.receipt_id AND d.execution_version=NEW.execution_version AND d.source_system='INTERNAL'
      AND d.principal_ref='employee:'||NEW.reviewer_employee_id::text AND d.action=NEW.action AND d.reason=NEW.reason
      AND d.event_id=NEW.submission_id) IS NOT TRUE THEN RAISE EXCEPTION 'Internal cargo decision mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.action='CLEAR' THEN
    SELECT * INTO c FROM public.cargo_fleet_clearances WHERE clearance_id=NEW.clearance_id;
    IF (c.execution_id=e.execution_id AND c.receipt_id=NEW.receipt_id AND c.version=NEW.execution_version
      AND c.authorized_employee_id=NEW.reviewer_employee_id AND c.safety_evidence_ref=NEW.review_id::text) IS NOT TRUE THEN
      RAISE EXCEPTION 'Internal cargo securement mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_internal_review_binding ON public.cargo_internal_reviews;
CREATE TRIGGER cargo_internal_review_binding BEFORE INSERT ON public.cargo_internal_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_internal_review();
DROP TRIGGER IF EXISTS cargo_internal_review_history ON public.cargo_internal_reviews;
CREATE TRIGGER cargo_internal_review_history BEFORE UPDATE OR DELETE ON public.cargo_internal_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();

ALTER TABLE public.cargo_execution_commands ADD COLUMN IF NOT EXISTS internal_review_id uuid REFERENCES public.cargo_internal_reviews(review_id) ON DELETE RESTRICT;
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_execution_commands_command_kind_check;
ALTER TABLE public.cargo_execution_commands ADD CONSTRAINT cargo_execution_commands_command_kind_check CHECK(command_kind IN ('RECEIPT','DECISION','CLEARANCE','MANUAL_DECISION','EVIDENCE','INTERNAL_REVIEW'));
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_commands_internal_review_kind;
ALTER TABLE public.cargo_execution_commands ADD CONSTRAINT cargo_commands_internal_review_kind CHECK((command_kind='INTERNAL_REVIEW')=(internal_review_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.guard_cargo_command_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.cargo_trip_executions; a public.audit_logs; c public.cargo_fleet_clearances; r public.cargo_receipts; d public.cargo_decisions; p public.cargo_manual_decision_provenance; photo public.cargo_evidence; review public.cargo_internal_reviews;
BEGIN
  SELECT * INTO e FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
  SELECT * INTO a FROM public.audit_logs WHERE log_id=NEW.audit_log_id;
  IF (NEW.response->>'execution_id'=e.execution_id::text AND NEW.response->>'trip_id'=e.trip_id::text
    AND NEW.response->>'version'=e.version::text AND NEW.response->'manifest'=e.manifest
    AND a.resource='cargo_execution' AND a.resource_id=e.trip_id
    AND a.action=CASE NEW.command_kind WHEN 'RECEIPT' THEN 'cargo_receipt' WHEN 'DECISION' THEN 'cargo_decision' WHEN 'MANUAL_DECISION' THEN 'cargo_manual_decision' WHEN 'EVIDENCE' THEN 'cargo_evidence' WHEN 'INTERNAL_REVIEW' THEN 'cargo_internal_review' ELSE 'cargo_clearance' END
    AND a.new_values->>'command_id'=NEW.command_id::text) IS NOT TRUE THEN
    RAISE EXCEPTION 'Cargo command response or audit mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.command_kind='INTERNAL_REVIEW' THEN
    SELECT * INTO review FROM public.cargo_internal_reviews WHERE review_id=NEW.internal_review_id;
    IF (review.execution_id=e.execution_id AND review.receipt_id=NEW.receipt_id AND review.execution_version=e.version
      AND a.employee_id=review.reviewer_employee_id AND NEW.command_key=review.submission_id::text AND NEW.payload_hash=review.payload_hash
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.response->'internal_reviews') item WHERE item->>'review_id'=review.review_id::text)) IS NOT TRUE THEN
      RAISE EXCEPTION 'Internal cargo command actor mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.command_kind='EVIDENCE' THEN
    SELECT * INTO photo FROM public.cargo_evidence WHERE evidence_id=NEW.evidence_id;
    IF (photo.execution_id=e.execution_id AND photo.state IN ('READY','ATTACHED') AND photo.uploader_employee_id=a.employee_id
      AND NEW.command_key=photo.evidence_id::text AND NEW.payload_hash=photo.content_hash AND NEW.response->'evidence_upload'->>'evidence_id'=photo.evidence_id::text) IS NOT TRUE THEN
      RAISE EXCEPTION 'Cargo command evidence mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.clearance_id IS NOT NULL THEN
    SELECT * INTO c FROM public.cargo_fleet_clearances WHERE clearance_id=NEW.clearance_id;
    IF c.execution_id IS DISTINCT FROM NEW.execution_id OR c.receipt_id IS DISTINCT FROM NEW.receipt_id OR c.version<>e.version
      OR a.employee_id IS DISTINCT FROM c.authorized_employee_id OR NEW.response->'fleet_clearance'->>'clearance_id' IS DISTINCT FROM c.clearance_id::text THEN
      RAISE EXCEPTION 'Cargo command clearance mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.command_kind='RECEIPT' THEN
    SELECT * INTO r FROM public.cargo_receipts WHERE receipt_id=NEW.receipt_id;
    IF r.execution_version<>e.version OR NEW.command_key IS DISTINCT FROM r.submission_id::text
      OR NEW.payload_hash IS DISTINCT FROM r.payload_hash OR a.employee_id IS DISTINCT FROM r.reporter_employee_id
      OR NEW.response->(CASE r.stage WHEN 'PICKUP' THEN 'pickup_receipt' ELSE 'delivery_receipt' END)->>'receipt_id' IS DISTINCT FROM r.receipt_id::text THEN
      RAISE EXCEPTION 'Cargo command receipt mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO d FROM public.cargo_decisions WHERE decision_id=NEW.decision_id;
    IF d.execution_version<>e.version OR NEW.command_key IS DISTINCT FROM d.event_id::text OR NEW.payload_hash IS DISTINCT FROM d.payload_hash
      OR NEW.response->'source_decision'->>'decision_id' IS DISTINCT FROM d.decision_id::text THEN
      RAISE EXCEPTION 'Cargo command decision mismatch' USING ERRCODE='23514'; END IF;
    SELECT * INTO p FROM public.cargo_manual_decision_provenance WHERE decision_id=d.decision_id;
    IF NEW.command_kind='MANUAL_DECISION' THEN
      IF p.decision_id IS NULL OR p.execution_id IS DISTINCT FROM e.execution_id OR a.employee_id IS DISTINCT FROM p.recording_employee_id
        OR NEW.response->'source_decision'->'manual_provenance' IS DISTINCT FROM to_jsonb(p) THEN
        RAISE EXCEPTION 'Cargo manual command provenance mismatch' USING ERRCODE='23514'; END IF;
    ELSIF a.employee_id IS NOT NULL OR p.decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cargo machine command actor mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.require_cargo_internal_review_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.cargo_execution_commands c JOIN public.audit_logs a ON a.log_id=c.audit_log_id
    WHERE c.internal_review_id=NEW.review_id AND c.command_kind='INTERNAL_REVIEW'
      AND a.employee_id=NEW.reviewer_employee_id AND a.action='cargo_internal_review';
  IF NOT FOUND THEN RAISE EXCEPTION 'Internal cargo review requires its audited immutable response' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_internal_review_command_required ON public.cargo_internal_reviews;
CREATE CONSTRAINT TRIGGER cargo_internal_review_command_required AFTER INSERT ON public.cargo_internal_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_cargo_internal_review_command();
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_internal_review() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_command_binding() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.require_cargo_internal_review_command() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.require_cargo_internal_authority_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE internal_source boolean;
BEGIN
  IF TG_TABLE_NAME='cargo_decisions' THEN
    internal_source := NEW.source_system='INTERNAL';
    IF internal_source AND NOT EXISTS(SELECT 1 FROM public.cargo_internal_reviews WHERE decision_id=NEW.decision_id AND kind='SOURCE') THEN
      RAISE EXCEPTION 'Internal cargo decision requires authenticated manager review' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT manifest->'source_ref'->>'system'='INTERNAL' INTO internal_source FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id;
    IF internal_source AND NOT EXISTS(SELECT 1 FROM public.cargo_internal_reviews WHERE clearance_id=NEW.clearance_id AND kind='SECUREMENT' AND action='CLEAR') THEN
      RAISE EXCEPTION 'Internal cargo clearance requires authenticated manager review' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_internal_decision_review_required ON public.cargo_decisions;
CREATE CONSTRAINT TRIGGER cargo_internal_decision_review_required AFTER INSERT ON public.cargo_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_cargo_internal_authority_review();
DROP TRIGGER IF EXISTS cargo_internal_clearance_review_required ON public.cargo_fleet_clearances;
CREATE CONSTRAINT TRIGGER cargo_internal_clearance_review_required AFTER INSERT ON public.cargo_fleet_clearances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_cargo_internal_authority_review();
REVOKE ALL PRIVILEGES ON FUNCTION public.require_cargo_internal_authority_review() FROM PUBLIC, anon, authenticated;
