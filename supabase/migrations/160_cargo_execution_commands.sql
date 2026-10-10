-- UNAPPLIED candidate: original service responses bound to mandatory transaction audit.
CREATE TABLE IF NOT EXISTS public.cargo_execution_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.cargo_trip_executions(execution_id),
  command_kind text NOT NULL CHECK(command_kind IN ('RECEIPT','DECISION','CLEARANCE')),
  command_key text NOT NULL CHECK(length(command_key) BETWEEN 1 AND 255),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  receipt_id uuid NOT NULL,
  decision_id uuid REFERENCES public.cargo_decisions(decision_id),
  clearance_id uuid REFERENCES public.cargo_fleet_clearances(clearance_id),
  audit_log_id bigint NOT NULL UNIQUE REFERENCES public.audit_logs(log_id),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_id,execution_id) REFERENCES public.cargo_receipts(receipt_id,execution_id),
  FOREIGN KEY(decision_id,receipt_id) REFERENCES public.cargo_decisions(decision_id,receipt_id),
  UNIQUE(execution_id,command_kind,command_key),
  CHECK((command_kind='DECISION')=(decision_id IS NOT NULL)),
  CHECK((command_kind='CLEARANCE')=(clearance_id IS NOT NULL))
);
CREATE OR REPLACE FUNCTION public.guard_cargo_command_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.cargo_trip_executions; a public.audit_logs; c public.cargo_fleet_clearances; r public.cargo_receipts; d public.cargo_decisions;
BEGIN
  SELECT * INTO e FROM public.cargo_trip_executions WHERE execution_id=NEW.execution_id FOR UPDATE;
  SELECT * INTO a FROM public.audit_logs WHERE log_id=NEW.audit_log_id;
  IF (NEW.response->>'execution_id'=e.execution_id::text AND NEW.response->>'trip_id'=e.trip_id::text
    AND NEW.response->>'version'=e.version::text AND NEW.response->'manifest'=e.manifest
    AND a.resource='cargo_execution' AND a.resource_id=e.trip_id
    AND a.action=CASE NEW.command_kind WHEN 'RECEIPT' THEN 'cargo_receipt' WHEN 'DECISION' THEN 'cargo_decision' ELSE 'cargo_clearance' END
    AND a.new_values->>'command_id'=NEW.command_id::text) IS NOT TRUE THEN
    RAISE EXCEPTION 'Cargo command response or audit mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.clearance_id IS NOT NULL THEN
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
      OR a.employee_id IS NOT NULL OR NEW.response->'source_decision'->>'decision_id' IS DISTINCT FROM d.decision_id::text THEN
      RAISE EXCEPTION 'Cargo command decision mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cargo_command_binding ON public.cargo_execution_commands;
CREATE TRIGGER cargo_command_binding BEFORE INSERT ON public.cargo_execution_commands FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_command_binding();
DROP TRIGGER IF EXISTS cargo_command_immutable ON public.cargo_execution_commands;
CREATE TRIGGER cargo_command_immutable BEFORE UPDATE OR DELETE ON public.cargo_execution_commands FOR EACH ROW EXECUTE FUNCTION public.guard_cargo_history();
ALTER TABLE public.cargo_execution_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.cargo_execution_commands FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_cargo_command_binding() FROM PUBLIC, anon, authenticated;
