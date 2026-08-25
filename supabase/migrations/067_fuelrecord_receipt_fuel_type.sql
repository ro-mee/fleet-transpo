-- Fuel-type mismatch detection: store the fuel product stated on the scanned
-- receipt so verification can compare it against the vehicle's fuel type.
-- Nullable by design — receipts frequently omit the product line.
ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS receipt_fuel_type TEXT;
