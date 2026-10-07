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

-- IF NOT EXISTS only compares names: reject a same-named but wrong/partial index.
DO $$
DECLARE
  idx_is_unique boolean;
  idx_is_valid boolean;
BEGIN
  SELECT i.indisunique, i.indisvalid INTO idx_is_unique, idx_is_valid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'vehicles_fleet_asset_code_uq';
  IF NOT FOUND THEN
    CREATE UNIQUE INDEX vehicles_fleet_asset_code_uq
      ON public.vehicles (fleet_asset_code);
  ELSIF idx_is_unique IS DISTINCT FROM TRUE OR idx_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Existing vehicles_fleet_asset_code_uq is not a valid unique index';
  END IF;
END $$;

-- Bounded operational use: Passenger or Cargo only. NULL means unclassified
-- legacy stock awaiting the Task 7 inventory, never an implicit default.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vehicles_operational_use'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT chk_vehicles_operational_use
      CHECK (operational_use IS NULL OR operational_use IN ('Passenger', 'Cargo'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vehicles_cargo_capacity'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT chk_vehicles_cargo_capacity
      CHECK (
        cargo_capacity_kg IS NULL
        OR (cargo_capacity_kg > 0 AND cargo_capacity_kg <> 'NaN'::numeric)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vehicles_commissioning_status'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT chk_vehicles_commissioning_status
      CHECK (commissioning_status IN ('Pending', 'Ready'));
  END IF;
END $$;

-- Document verification audit: fleet managers submit evidence; only admin or
-- system_admin may attest it Verified with verifier identity and timestamp.
-- Rows without an attestation stay Pending, never implicitly verified.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vehicledocuments_verification_status'
  ) THEN
    ALTER TABLE public.vehicledocuments
      ADD CONSTRAINT chk_vehicledocuments_verification_status
      CHECK (verification_status IN ('Pending', 'Verified', 'Rejected'));
  END IF;
END $$;

COMMIT;
