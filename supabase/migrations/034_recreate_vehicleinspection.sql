-- ============================================
-- MIGRATION 028: Recreate vehicleinspection
--
-- Purpose:
--   Restore the `vehicleinspection` table backing the driver-facing
--   GET /api/driver/vehicle-inspection endpoint.
--
--   The table was DROPPED in migration 005 (merged into vehiclemaintenance),
--   and the merged inspection columns were later dropped in 018. The endpoint
--   added in the driver-portal work still queries `vehicleinspection`, so it
--   returned 500 ("relation does not exist"). This recreates the table to the
--   exact schema the endpoint reads, so a driver can view the latest
--   inspection snapshot for their currently-assigned vehicle.
--
--   RLS is intentionally omitted: the application-layer requireDriver guard is
--   the real authorization boundary (mirrors the rest of the schema).
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS vehicleinspection (
  inspection_id   SERIAL PRIMARY KEY,
  vehicle_id      INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id       INT REFERENCES drivers(driver_id),
  inspection_type VARCHAR(50) NOT NULL,
  inspection_date DATE NOT NULL,
  checklist       JSONB,
  findings        TEXT,
  severity        VARCHAR(20),
  status          VARCHAR(50) DEFAULT 'Pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Fastest lookups for the endpoint: newest inspection for an assigned vehicle.
CREATE INDEX IF NOT EXISTS idx_vehicleinspection_vehicle_date
  ON vehicleinspection (vehicle_id, inspection_date DESC, created_at DESC);

COMMIT;
