-- Fuel request approval and allocation. An approved request is the allocation;
-- its final receipt is linked through fuelrecords.fuel_request_id.
CREATE TABLE IF NOT EXISTS fuelrequests (
  fuel_request_id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INTEGER NOT NULL REFERENCES drivers(driver_id),
  trip_id INTEGER NOT NULL REFERENCES trips(trip_id),
  requested_liters NUMERIC(10,2) NOT NULL CHECK (requested_liters > 0 AND requested_liters <= 1000),
  approved_liters NUMERIC(10,2) CHECK (approved_liters > 0 AND approved_liters <= requested_liters),
  purpose TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Fulfilled')),
  review_notes TEXT,
  approved_by INTEGER REFERENCES employees(employee_id),
  approved_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  client_submission_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuelrequests_driver_submission
  ON fuelrequests(driver_id, client_submission_id)
  WHERE client_submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuelrequests_open_trip
  ON fuelrequests(trip_id)
  WHERE status IN ('Pending', 'Approved');

CREATE INDEX IF NOT EXISTS idx_fuelrequests_status_created
  ON fuelrequests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fuelrequests_driver_created
  ON fuelrequests(driver_id, created_at DESC);

ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS fuel_request_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_fuelrecords_fuel_request'
  ) THEN
    ALTER TABLE fuelrecords
      ADD CONSTRAINT fk_fuelrecords_fuel_request
      FOREIGN KEY (fuel_request_id) REFERENCES fuelrequests(fuel_request_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuelrecords_fuel_request
  ON fuelrecords(fuel_request_id)
  WHERE fuel_request_id IS NOT NULL;
