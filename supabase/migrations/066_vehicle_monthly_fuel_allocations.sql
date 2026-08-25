-- Vehicle-based replenishment: monthly budget, vehicle fuel profile, and an
-- explainable request snapshot. Trips remain optional traceability only.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS tank_capacity_l NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fuel_efficiency_kmpl NUMERIC(8,2);

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_tank_capacity;
ALTER TABLE vehicles ADD CONSTRAINT chk_vehicle_tank_capacity
  CHECK (tank_capacity_l IS NULL OR (tank_capacity_l > 0 AND tank_capacity_l <= 1000));

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_fuel_efficiency;
ALTER TABLE vehicles ADD CONSTRAINT chk_vehicle_fuel_efficiency
  CHECK (fuel_efficiency_kmpl IS NULL OR (fuel_efficiency_kmpl > 0 AND fuel_efficiency_kmpl <= 100));

CREATE TABLE IF NOT EXISTS fuelallocations (
  allocation_id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(vehicle_id),
  allocation_month DATE NOT NULL,
  allocated_liters NUMERIC(12,2) NOT NULL CHECK (allocated_liters > 0),
  created_by INTEGER REFERENCES employees(employee_id),
  updated_by INTEGER REFERENCES employees(employee_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, allocation_month),
  CHECK (allocation_month = DATE_TRUNC('month', allocation_month)::date)
);

CREATE INDEX IF NOT EXISTS idx_fuelallocations_month
  ON fuelallocations(allocation_month, vehicle_id);

ALTER TABLE fuelrequests ALTER COLUMN trip_id DROP NOT NULL;
ALTER TABLE fuelrequests
  ADD COLUMN IF NOT EXISTS current_fuel_level_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS recommended_liters NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS forecast_distance_km NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS allocation_month DATE,
  ADD COLUMN IF NOT EXISTS calculation_snapshot JSONB;

UPDATE fuelrequests
   SET allocation_month = DATE_TRUNC('month', created_at)::date
 WHERE allocation_month IS NULL;

ALTER TABLE fuelrequests ALTER COLUMN allocation_month SET NOT NULL;

ALTER TABLE fuelrequests DROP CONSTRAINT IF EXISTS fuelrequests_check;
ALTER TABLE fuelrequests DROP CONSTRAINT IF EXISTS chk_fuelrequest_approved_liters;
ALTER TABLE fuelrequests ADD CONSTRAINT chk_fuelrequest_approved_liters
  CHECK (approved_liters IS NULL OR (approved_liters > 0 AND approved_liters <= 1000));

ALTER TABLE fuelrequests DROP CONSTRAINT IF EXISTS chk_fuelrequest_current_level;
ALTER TABLE fuelrequests ADD CONSTRAINT chk_fuelrequest_current_level
  CHECK (current_fuel_level_percent IS NULL OR current_fuel_level_percent BETWEEN 0 AND 100);

DROP INDEX IF EXISTS uq_fuelrequests_open_trip;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuelrequests_open_vehicle
  ON fuelrequests(vehicle_id)
  WHERE status IN ('Pending', 'Approved');

CREATE INDEX IF NOT EXISTS idx_fuelrequests_allocation_month
  ON fuelrequests(allocation_month, vehicle_id);
