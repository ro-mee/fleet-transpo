-- 025_uvvrp.sql
-- Number Coding (UVVRP) Validation Module.
--
-- Two tables support the configurable plate-coding policy:
--   uvvrp_exemptions  - per-vehicle coding exemptions (category + approver).
--   uvvrp_violations  - every coding event at dispatch time (blocked/warned/
--                       pending_approval/approved/denied) = the audit history.
-- RLS is enabled but inert (app-layer auth), consistent with every other table.
BEGIN;

CREATE TABLE IF NOT EXISTS uvvrp_exemptions (
  exemption_id SERIAL PRIMARY KEY,
  vehicle_id   INT NOT NULL REFERENCES vehicles(vehicle_id),
  category     VARCHAR(100) NOT NULL,
  reason       TEXT,
  approved_by  INT REFERENCES employees(employee_id),
  approved_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_on   DATE,
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uvvrp_exemptions_vehicle ON uvvrp_exemptions (vehicle_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_uvvrp_exemptions_active ON uvvrp_exemptions (active);

CREATE TABLE IF NOT EXISTS uvvrp_violations (
  violation_id         SERIAL PRIMARY KEY,
  vehicle_id           INT NOT NULL REFERENCES vehicles(vehicle_id),
  dispatch_id          INT REFERENCES dispatchschedules(dispatch_id),
  scheduled_departure  TIMESTAMPTZ,
  weekday              VARCHAR(20),
  plate_digit          INT,
  action               VARCHAR(30) NOT NULL DEFAULT 'blocked',
  reason               TEXT,
  created_by           INT REFERENCES employees(employee_id),
  decided_by           INT REFERENCES employees(employee_id),
  decided_at           TIMESTAMPTZ,
  decision_reason      TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uvvrp_violations_vehicle ON uvvrp_violations (vehicle_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_uvvrp_violations_action ON uvvrp_violations (action, created_at DESC);

ALTER TABLE uvvrp_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uvvrp_violations ENABLE ROW LEVEL SECURITY;

COMMIT;
