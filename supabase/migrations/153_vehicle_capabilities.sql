-- Prepared only; provisional number 153 pending a fresh `npm run db:status`
-- immediately before apply (live applied through 149 at the 2026-10-07 check;
-- branch drafts occupy 150-152). Never applied as part of Task 4.
-- Additive and nullable only: no historical vehicle or document row is
-- rewritten, and no plate, weight, capacity or compliance evidence is
-- synthesized. Existing incomplete records stay auditable for the Task 7
-- rollout inventory.
BEGIN;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS fleet_asset_code varchar(50),
  ADD COLUMN IF NOT EXISTS operational_use varchar(20),
  ADD COLUMN IF NOT EXISTS cargo_capacity_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS commissioning_status varchar(20) DEFAULT 'Pending';

ALTER TABLE public.vehicledocuments
  ADD COLUMN IF NOT EXISTS verification_status varchar(20) DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS verified_by integer,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Plate-less pending assets are identified by fleet_asset_code, never fake plates.
ALTER TABLE public.vehicles ALTER COLUMN plate_number DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_fleet_asset_code_uq ON public.vehicles (fleet_asset_code);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attname = 'fleet_asset_code'
    WHERE ns.nspname = 'public' AND tbl.relname = 'vehicles'
      AND idx.relname = 'vehicles_fleet_asset_code_uq'
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts = 1 AND i.indnatts = 1
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indkey[0] = a.attnum
  ) THEN
    RAISE EXCEPTION 'vehicles_fleet_asset_code_uq is not the required full unique index';
  END IF;
END $$;

DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_chk_vehicles_operational_use ON COMMIT DROP AS
    SELECT * FROM public.vehicles WITH NO DATA;
  ALTER TABLE pg_temp._expected_chk_vehicles_operational_use ADD CONSTRAINT expected_check CHECK (operational_use IS NULL OR operational_use IN ('Passenger', 'Cargo'));
  SELECT pg_get_constraintdef(oid) INTO expected_constraint_definition
    FROM pg_constraint WHERE conrelid = 'pg_temp._expected_chk_vehicles_operational_use'::regclass AND conname = 'expected_check';
  SELECT pg_get_constraintdef(oid), convalidated INTO constraint_definition, constraint_is_valid
    FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'chk_vehicles_operational_use';
  IF constraint_definition IS NULL THEN
    ALTER TABLE public.vehicles ADD CONSTRAINT chk_vehicles_operational_use CHECK (operational_use IS NULL OR operational_use IN ('Passenger', 'Cargo'));
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_vehicles_operational_use exists with a mismatched or unvalidated definition';
  END IF;
END $$;

DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_chk_vehicles_cargo_capacity ON COMMIT DROP AS
    SELECT * FROM public.vehicles WITH NO DATA;
  ALTER TABLE pg_temp._expected_chk_vehicles_cargo_capacity ADD CONSTRAINT expected_check CHECK (cargo_capacity_kg IS NULL OR (cargo_capacity_kg > 0 AND cargo_capacity_kg <> 'NaN'::numeric));
  SELECT pg_get_constraintdef(oid) INTO expected_constraint_definition
    FROM pg_constraint WHERE conrelid = 'pg_temp._expected_chk_vehicles_cargo_capacity'::regclass AND conname = 'expected_check';
  SELECT pg_get_constraintdef(oid), convalidated INTO constraint_definition, constraint_is_valid
    FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'chk_vehicles_cargo_capacity';
  IF constraint_definition IS NULL THEN
    ALTER TABLE public.vehicles ADD CONSTRAINT chk_vehicles_cargo_capacity CHECK (cargo_capacity_kg IS NULL OR (cargo_capacity_kg > 0 AND cargo_capacity_kg <> 'NaN'::numeric));
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_vehicles_cargo_capacity exists with a mismatched or unvalidated definition';
  END IF;
END $$;

DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_chk_vehicles_commissioning_status ON COMMIT DROP AS
    SELECT * FROM public.vehicles WITH NO DATA;
  ALTER TABLE pg_temp._expected_chk_vehicles_commissioning_status ADD CONSTRAINT expected_check CHECK (commissioning_status IN ('Pending', 'Ready'));
  SELECT pg_get_constraintdef(oid) INTO expected_constraint_definition
    FROM pg_constraint WHERE conrelid = 'pg_temp._expected_chk_vehicles_commissioning_status'::regclass AND conname = 'expected_check';
  SELECT pg_get_constraintdef(oid), convalidated INTO constraint_definition, constraint_is_valid
    FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND conname = 'chk_vehicles_commissioning_status';
  IF constraint_definition IS NULL THEN
    ALTER TABLE public.vehicles ADD CONSTRAINT chk_vehicles_commissioning_status CHECK (commissioning_status IN ('Pending', 'Ready'));
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_vehicles_commissioning_status exists with a mismatched or unvalidated definition';
  END IF;
END $$;

DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_chk_vehicledocuments_verification_status ON COMMIT DROP AS
    SELECT * FROM public.vehicledocuments WITH NO DATA;
  ALTER TABLE pg_temp._expected_chk_vehicledocuments_verification_status ADD CONSTRAINT expected_check CHECK (verification_status IN ('Pending', 'Verified', 'Rejected'));
  SELECT pg_get_constraintdef(oid) INTO expected_constraint_definition
    FROM pg_constraint WHERE conrelid = 'pg_temp._expected_chk_vehicledocuments_verification_status'::regclass AND conname = 'expected_check';
  SELECT pg_get_constraintdef(oid), convalidated INTO constraint_definition, constraint_is_valid
    FROM pg_constraint WHERE conrelid = 'public.vehicledocuments'::regclass AND conname = 'chk_vehicledocuments_verification_status';
  IF constraint_definition IS NULL THEN
    ALTER TABLE public.vehicledocuments ADD CONSTRAINT chk_vehicledocuments_verification_status CHECK (verification_status IN ('Pending', 'Verified', 'Rejected'));
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_vehicledocuments_verification_status exists with a mismatched or unvalidated definition';
  END IF;
END $$;

COMMIT;
