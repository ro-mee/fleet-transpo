-- Prepared only; provisional number 155 pending a fresh `npm run db:status`
-- immediately before apply (live applied through 149 at the 2026-10-07 check;
-- branch drafts occupy 150-154). Never applied as part of Task 11.
-- Additive only: estimate columns on the already-classified trips table, no
-- existing row rewritten, and trips.fuel_consumed keeps its meaning untouched.
-- The snapshot FK requires 154_fuel_price_snapshots to apply first; filename
-- order guarantees that, and a missing parent table aborts this migration
-- rather than writing dangling references.
BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS planned_distance_km numeric(12,2),
  ADD COLUMN IF NOT EXISTS actual_distance_km numeric(12,2),
  ADD COLUMN IF NOT EXISTS distance_provenance varchar(30),
  ADD COLUMN IF NOT EXISTS estimated_fuel_l numeric(12,3),
  ADD COLUMN IF NOT EXISTS estimated_fuel_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS fuel_reference_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS fuel_price_snapshot_id bigint,
  ADD COLUMN IF NOT EXISTS fuel_region varchar(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trips_fuel_price_snapshot'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT fk_trips_fuel_price_snapshot
      FOREIGN KEY (fuel_price_snapshot_id)
      REFERENCES public.fuel_price_snapshots (snapshot_id);
  END IF;
END $$;

COMMIT;
