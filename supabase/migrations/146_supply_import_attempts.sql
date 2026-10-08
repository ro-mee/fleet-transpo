BEGIN;

-- Keep rejected sandbox submissions separate from the idempotent inbox:
-- malformed events may not have trusted event keys, and conflicts cannot be
-- inserted into the inbox without violating its source identity constraints.
CREATE TABLE IF NOT EXISTS public.supply_integration_attempts (
  supply_integration_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id varchar(128),
  external_request_id varchar(128),
  source_event_id varchar(255),
  source_sequence bigint,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  rejection_code varchar(48) NOT NULL CHECK (rejection_code IN (
    'SCHEMA_INVALID',
    'SOURCE_EVENT_ID_CONFLICT',
    'SOURCE_SEQUENCE_CONFLICT',
    'SOURCE_REQUEST_CONFLICT',
    'BUSINESS_RULE_CONFLICT',
    'DATABASE_UNIQUENESS_CONFLICT'
  )),
  response_status smallint NOT NULL CHECK (response_status IN (400, 409)),
  actor_employee_id integer NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supply_attempt_sandbox_identity CHECK (
    source_organization_id IS NULL OR source_organization_id LIKE 'sandbox:%'
  ),
  CONSTRAINT chk_supply_attempt_identifier_lengths CHECK (
    (external_request_id IS NULL OR length(trim(external_request_id)) BETWEEN 1 AND 128) AND
    (source_event_id IS NULL OR length(trim(source_event_id)) BETWEEN 1 AND 255)
  ),
  CONSTRAINT chk_supply_attempt_sequence CHECK (source_sequence IS NULL OR source_sequence > 0)
);

CREATE INDEX IF NOT EXISTS idx_supply_integration_attempts_recent
  ON public.supply_integration_attempts (attempted_at DESC, supply_integration_attempt_id DESC);

ALTER TABLE public.supply_integration_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.supply_integration_attempts FROM anon, authenticated;

COMMIT;
