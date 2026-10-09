-- Private explicit reviews only. No roster backfill or operational activation.
CREATE TABLE IF NOT EXISTS driver_service_qualifications (
  qualification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id integer NOT NULL REFERENCES drivers(driver_id),
  qualification_group text NOT NULL CHECK (qualification_group IN ('PASSENGER','CARGO')),
  status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  policy_version text CHECK (policy_version IS NULL OR (length(btrim(policy_version)) > 0 AND length(policy_version) <= 128)),
  verified_by integer REFERENCES employees(employee_id),
  verified_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, qualification_group),
  CHECK (status <> 'ACTIVE' OR (verified_by IS NOT NULL AND verified_by > 0 AND verified_at IS NOT NULL AND isfinite(verified_at) AND policy_version IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS driver_service_qualification_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id uuid NOT NULL REFERENCES driver_service_qualifications(qualification_id),
  driver_id integer NOT NULL REFERENCES drivers(driver_id),
  actor_id integer NOT NULL REFERENCES employees(employee_id),
  old_group text CHECK (old_group IN ('PASSENGER','CARGO')),
  new_group text NOT NULL CHECK (new_group IN ('PASSENGER','CARGO')),
  old_status text CHECK (old_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  new_status text NOT NULL CHECK (new_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 2000),
  policy_version text CHECK (policy_version IS NULL OR (length(btrim(policy_version)) > 0 AND length(policy_version) <= 128)),
  version integer NOT NULL CHECK (version > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(qualification_id, version),
  CHECK (new_status <> 'ACTIVE' OR policy_version IS NOT NULL)
);
CREATE OR REPLACE FUNCTION reject_driver_qualification_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Driver qualification history is append-only' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS qualification_events_immutable ON driver_service_qualification_events;
CREATE TRIGGER qualification_events_immutable BEFORE UPDATE OR DELETE ON driver_service_qualification_events
FOR EACH ROW EXECUTE FUNCTION reject_driver_qualification_event_changes();
DROP TRIGGER IF EXISTS qualification_events_no_truncate ON driver_service_qualification_events;
CREATE TRIGGER qualification_events_no_truncate BEFORE TRUNCATE ON driver_service_qualification_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_driver_qualification_event_changes();
ALTER TABLE driver_service_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_service_qualification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON driver_service_qualifications, driver_service_qualification_events FROM anon, authenticated;
