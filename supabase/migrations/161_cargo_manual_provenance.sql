-- UNAPPLIED candidate. Existing cargo snapshots/audit/outbox remain canonical.
CREATE TABLE IF NOT EXISTS public.cargo_manual_decision_provenance (
  decision_id uuid PRIMARY KEY REFERENCES public.cargo_decisions(decision_id),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id),
  receipt_id uuid NOT NULL,
  recording_employee_id integer NOT NULL REFERENCES public.employees(employee_id),
  source_system text NOT NULL CHECK(source_system IN ('PMS','POS','SCM')),
  source_organization_id text NOT NULL,
  external_request_id text NOT NULL,
  approver_identity text NOT NULL CHECK(length(btrim(approver_identity)) BETWEEN 1 AND 255),
  approver_reference text NOT NULL CHECK(length(btrim(approver_reference)) BETWEEN 1 AND 255),
  communicated_at timestamptz NOT NULL,
  communication_evidence_ids uuid[] NOT NULL CHECK(cardinality(communication_evidence_ids) BETWEEN 1 AND 5),
  authority_reference text NOT NULL CHECK(length(btrim(authority_reference)) BETWEEN 1 AND 255),
  authority_approval_ref text NOT NULL CHECK(length(btrim(authority_approval_ref)) BETWEEN 1 AND 255),
  authority_proof jsonb NOT NULL CHECK(jsonb_typeof(authority_proof)='object'),
  command_payload jsonb NOT NULL CHECK(jsonb_typeof(command_payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_id,execution_id) REFERENCES public.cargo_receipts(receipt_id,execution_id),
  FOREIGN KEY(decision_id,receipt_id) REFERENCES public.cargo_decisions(decision_id,receipt_id)
);
CREATE OR REPLACE FUNCTION public.guard_cargo_manual_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.cargo_trip_executions; d public.cargo_decisions; r public.cargo_receipts; a jsonb; n integer;
BEGIN
  SELECT * INTO e FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
  SELECT * INTO d FROM public.cargo_decisions WHERE decision_id=NEW.decision_id;
  SELECT * INTO r FROM public.cargo_receipts WHERE receipt_id=NEW.receipt_id;
  a:=NEW.authority_proof;
  IF (r.execution_id=e.execution_id AND r.stage='PICKUP' AND d.receipt_id=r.receipt_id
    AND d.source_system=NEW.source_system AND d.source_organization_id=NEW.source_organization_id
    AND d.principal_ref=NEW.approver_reference AND d.manifest_hash=r.manifest_hash
    AND e.manifest->'source_ref'=jsonb_build_object('system',NEW.source_system,'organization_id',NEW.source_organization_id,'external_request_id',NEW.external_request_id)
    AND a->>'kind'='SOURCE_COMMUNICATION' AND a->>'method'='simulated-fixture' AND a->>'simulated'='true'
    AND a->'source_ref'=e.manifest->'source_ref' AND a->>'receipt_id'=r.receipt_id::text
    AND a->>'manifest_hash'=d.manifest_hash AND a->>'action'=d.action AND a->>'reason'=d.reason AND a->>'approval_ref'=NEW.authority_approval_ref AND a->>'reference'=NEW.authority_reference
    AND a->>'approver_identity'=NEW.approver_identity AND a->>'approver_reference'=NEW.approver_reference
    AND (a->>'communicated_at')::timestamptz=NEW.communicated_at AND a->'evidence_ids'=to_jsonb(NEW.communication_evidence_ids)
    AND NEW.command_payload->>'event_id'=d.event_id::text AND NEW.command_payload->>'receipt_id'=r.receipt_id::text
    AND NEW.command_payload->>'manifest_hash'=d.manifest_hash AND NEW.command_payload->>'action'=d.action
    AND NEW.command_payload->>'reason'=d.reason AND NEW.command_payload->>'approver_identity'=NEW.approver_identity
    AND NEW.command_payload->>'approver_reference'=NEW.approver_reference
    AND (NEW.command_payload->>'communicated_at')::timestamptz=NEW.communicated_at
    AND NEW.command_payload->'communication_evidence_ids'=to_jsonb(NEW.communication_evidence_ids)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Cargo manual authority binding mismatch' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT evidence_id) INTO n FROM public.cargo_evidence
    WHERE evidence_id=ANY(NEW.communication_evidence_ids) AND execution_id=NEW.execution_id AND state IN ('READY','ATTACHED');
  IF n<>cardinality(NEW.communication_evidence_ids) THEN
    RAISE EXCEPTION 'Cargo communication evidence mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_manual_provenance_binding ON public.cargo_manual_decision_provenance;
CREATE TRIGGER cargo_manual_provenance_binding BEFORE INSERT ON public.cargo_manual_decision_provenance FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_manual_provenance();
DROP TRIGGER IF EXISTS cargo_manual_provenance_immutable ON public.cargo_manual_decision_provenance;
CREATE TRIGGER cargo_manual_provenance_immutable BEFORE UPDATE OR DELETE ON public.cargo_manual_decision_provenance FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();

ALTER TABLE public.cargo_execution_commands ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES public.cargo_evidence(evidence_id);
ALTER TABLE public.cargo_execution_commands ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_execution_commands_command_kind_check;
ALTER TABLE public.cargo_execution_commands ADD CONSTRAINT cargo_execution_commands_command_kind_check CHECK(command_kind IN ('RECEIPT','DECISION','CLEARANCE','MANUAL_DECISION','EVIDENCE'));
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_execution_commands_check;
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_commands_decision_kind;
ALTER TABLE public.cargo_execution_commands ADD CONSTRAINT cargo_commands_decision_kind CHECK((command_kind IN ('DECISION','MANUAL_DECISION'))=(decision_id IS NOT NULL));
ALTER TABLE public.cargo_execution_commands DROP CONSTRAINT IF EXISTS cargo_commands_evidence_kind;
ALTER TABLE public.cargo_execution_commands ADD CONSTRAINT cargo_commands_evidence_kind CHECK((command_kind='EVIDENCE')=(evidence_id IS NOT NULL) AND (command_kind='EVIDENCE')=(receipt_id IS NULL));

CREATE OR REPLACE FUNCTION public.guard_cargo_command_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.cargo_trip_executions; a public.audit_logs; c public.cargo_fleet_clearances; r public.cargo_receipts; d public.cargo_decisions; p public.cargo_manual_decision_provenance; photo public.cargo_evidence;
BEGIN
  SELECT * INTO e FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
  SELECT * INTO a FROM public.audit_logs WHERE log_id=NEW.audit_log_id;
  IF (NEW.response->>'execution_id'=e.execution_id::text AND NEW.response->>'trip_id'=e.trip_id::text
    AND NEW.response->>'version'=e.version::text AND NEW.response->'manifest'=e.manifest
    AND a.resource='cargo_execution' AND a.resource_id=e.trip_id
    AND a.action=CASE NEW.command_kind WHEN 'RECEIPT' THEN 'cargo_receipt' WHEN 'DECISION' THEN 'cargo_decision' WHEN 'MANUAL_DECISION' THEN 'cargo_manual_decision' WHEN 'EVIDENCE' THEN 'cargo_evidence' ELSE 'cargo_clearance' END
    AND a.new_values->>'command_id'=NEW.command_id::text) IS NOT TRUE THEN
    RAISE EXCEPTION 'Cargo command response or audit mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.command_kind='EVIDENCE' THEN
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
ALTER TABLE public.cargo_manual_decision_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_manual_decision_provenance FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_manual_provenance() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_command_binding() FROM PUBLIC, anon, authenticated;
