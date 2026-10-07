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
  ADD COLUMN IF NOT EXISTS fuel_region varchar(100),
  ADD COLUMN IF NOT EXISTS fuel_efficiency_snapshot_kmpl numeric(12,4),
  ADD COLUMN IF NOT EXISTS planned_estimated_fuel_l numeric(12,3),
  ADD COLUMN IF NOT EXISTS planned_estimated_fuel_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS fuel_estimate_reason varchar(40),
  ADD COLUMN IF NOT EXISTS fuel_estimate_captured_at timestamptz;

DO $$
DECLARE
  incompatible_columns text;
  existing_fk record;
BEGIN
  -- IF NOT EXISTS is safe only if an existing column has the reviewed shape.
  SELECT string_agg(expected.name, ', ') INTO incompatible_columns
  FROM (VALUES
    ('planned_distance_km', 'numeric', 12, 2, NULL),
    ('actual_distance_km', 'numeric', 12, 2, NULL),
    ('distance_provenance', 'character varying', NULL, NULL, 30),
    ('estimated_fuel_l', 'numeric', 12, 3, NULL),
    ('estimated_fuel_cost', 'numeric', 12, 2, NULL),
    ('fuel_reference_price', 'numeric', 10, 2, NULL),
    ('fuel_price_snapshot_id', 'bigint', NULL, NULL, NULL),
    ('fuel_region', 'character varying', NULL, NULL, 100),
    ('fuel_efficiency_snapshot_kmpl', 'numeric', 12, 4, NULL),
    ('planned_estimated_fuel_l', 'numeric', 12, 3, NULL),
    ('planned_estimated_fuel_cost', 'numeric', 12, 2, NULL),
    ('fuel_estimate_reason', 'character varying', NULL, NULL, 40),
    ('fuel_estimate_captured_at', 'timestamp with time zone', NULL, NULL, NULL)
  ) AS expected(name, type_name, precision_value, scale_value, max_length)
  LEFT JOIN information_schema.columns AS actual ON actual.table_schema = 'public'
    AND actual.table_name = 'trips' AND actual.column_name = expected.name
  WHERE actual.column_name IS NULL OR actual.data_type <> expected.type_name
    OR (expected.precision_value IS NOT NULL AND actual.numeric_precision IS DISTINCT FROM expected.precision_value)
    OR (expected.scale_value IS NOT NULL AND actual.numeric_scale IS DISTINCT FROM expected.scale_value)
    OR (expected.max_length IS NOT NULL AND actual.character_maximum_length IS DISTINCT FROM expected.max_length)
    OR actual.is_nullable <> 'YES';
  IF incompatible_columns IS NOT NULL THEN
    RAISE EXCEPTION '155: incompatible existing trip estimate columns: %', incompatible_columns;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trips_fuel_price_snapshot' AND conrelid = 'public.trips'::regclass
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT fk_trips_fuel_price_snapshot
      FOREIGN KEY (fuel_price_snapshot_id)
      REFERENCES public.fuel_price_snapshots (snapshot_id);
  ELSE
    SELECT * INTO existing_fk FROM pg_constraint
      WHERE conname = 'fk_trips_fuel_price_snapshot' AND conrelid = 'public.trips'::regclass;
    IF existing_fk.contype <> 'f'
      OR existing_fk.confrelid <> 'public.fuel_price_snapshots'::regclass
      OR existing_fk.conkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.trips'::regclass AND attname = 'fuel_price_snapshot_id')]::smallint[]
      OR existing_fk.confkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.fuel_price_snapshots'::regclass AND attname = 'snapshot_id')]::smallint[]
      OR NOT existing_fk.convalidated OR existing_fk.condeferrable
      OR existing_fk.confdeltype <> 'a' OR existing_fk.confupdtype <> 'a' THEN
      RAISE EXCEPTION '155: fk_trips_fuel_price_snapshot has an incompatible or unvalidated definition';
    END IF;
  END IF;
END $$;

COMMIT;
