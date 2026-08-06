-- 024_driverincidents.sql
-- Recreate the driverincidents table.
--
-- The original table was dropped by migration 005 (schema cleanup). The driver
-- portal and /api/driver/incidents still reference it, so it was missing at
-- runtime and incident reporting was broken. Recreate it with the same columns
-- the code reads/writes, plus soft-delete for consistency with the rest of the
-- schema. RLS is inert in this deployment (app-layer auth), matching every other
-- table.
BEGIN;

CREATE TABLE IF NOT EXISTS driverincidents (
  incident_id  SERIAL PRIMARY KEY,
  driver_id    INT NOT NULL REFERENCES drivers(driver_id),
  vehicle_id   INT REFERENCES vehicles(vehicle_id),
  trip_id      INT REFERENCES trips(trip_id),
  incident_type VARCHAR(100) NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description  TEXT,
  location     TEXT,
  severity     VARCHAR(20) DEFAULT 'Minor',
  is_at_fault  BOOLEAN DEFAULT FALSE,
  actions_taken TEXT,
  status       VARCHAR(50) DEFAULT 'Open',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driverincidents_driver ON driverincidents (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driverincidents_status ON driverincidents (status, incident_date DESC);

COMMIT;
