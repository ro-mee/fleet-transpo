-- Persist an auditable staff review for driver licenses and the license class
-- required by each vehicle. Existing rows remain intact and unverified/unmapped
-- until staff review them; dispatch eligibility fails closed for those rows.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS license_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS license_verified_by INTEGER,
  ADD COLUMN IF NOT EXISTS license_verification_method VARCHAR(30);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS required_license_class VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_drivers_license_verified_by'
       AND conrelid = 'drivers'::regclass
  ) THEN
    ALTER TABLE drivers
      ADD CONSTRAINT fk_drivers_license_verified_by
      FOREIGN KEY (license_verified_by) REFERENCES employees(employee_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_drivers_license_verification_method'
       AND conrelid = 'drivers'::regclass
  ) THEN
    ALTER TABLE drivers
      ADD CONSTRAINT chk_drivers_license_verification_method
      CHECK (license_verification_method IS NULL OR license_verification_method IN ('physical_card', 'lto_digital_id'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_drivers_license_verification_record'
       AND conrelid = 'drivers'::regclass
  ) THEN
    ALTER TABLE drivers
      ADD CONSTRAINT chk_drivers_license_verification_record
      CHECK (
        license_verified_at IS NULL OR
        (license_verified_by IS NOT NULL AND license_verification_method IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_vehicles_required_license_class'
       AND conrelid = 'vehicles'::regclass
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT chk_vehicles_required_license_class
      CHECK (required_license_class IS NULL OR required_license_class IN ('B', 'B1'));
  END IF;
END $$;
