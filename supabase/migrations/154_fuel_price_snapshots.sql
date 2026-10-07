-- Prepared only; provisional number 154 pending a fresh `npm run db:status`
-- immediately before apply (live applied through 149 at the 2026-10-07 check;
-- branch drafts occupy 150-153). Never applied as part of Task 10.
-- Additive only: a new table, no existing row rewritten, no price synthesized.
-- Reference prices never replace receipt pump prices; per-trip snapshots are a
-- later task that copies these values, never a live link to them.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fuel_price_snapshots (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuel_product varchar(30) NOT NULL,
  region varchar(100) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'PHP',
  unit varchar(10) NOT NULL DEFAULT 'L',
  reference_price numeric(10,2) NOT NULL CHECK (reference_price > 0 AND reference_price <> 'NaN'::numeric),
  prior_price numeric(10,2) CHECK (prior_price IS NULL OR (prior_price > 0 AND prior_price <> 'NaN'::numeric)),
  announced_at timestamptz,
  effective_at timestamptz NOT NULL,
  fetched_at timestamptz,
  source_url text NOT NULL CHECK (btrim(source_url) <> ''),
  verification_method varchar(20) NOT NULL CHECK (verification_method IN ('Manual', 'Automatic')),
  lifecycle varchar(20) NOT NULL DEFAULT 'Pending' CHECK (lifecycle IN ('Pending', 'Active', 'Historical')),
  source_hash varchar(128),
  verified_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_fuel_snapshot_currency CHECK (currency = 'PHP'),
  CONSTRAINT chk_fuel_snapshot_unit CHECK (unit = 'L'),
  CONSTRAINT chk_fuel_snapshot_verification CHECK (
    (verification_method = 'Manual' AND verified_by IS NOT NULL AND verified_by > 0) OR
    (verification_method = 'Automatic' AND source_hash IS NOT NULL AND btrim(source_hash) <> '')
  )
);

-- Unique source/version/effectivity key: a repeated ingestion of the same
-- announcement is ignored by the constraint rather than stored twice. A
-- correction is a NEW row with a later effective_at, so historical instants
-- keep resolving to the price that was actually in effect then.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_price_snapshot_effectivity
  ON public.fuel_price_snapshots (fuel_product, region, effective_at);

-- A same-named existing object must not silently bypass the draft contract.
DO $$
DECLARE
  incompatible_columns text;
  effectivity_index record;
BEGIN
  SELECT string_agg(expected.name, ', ') INTO incompatible_columns
  FROM (VALUES
    ('snapshot_id', 'bigint', NULL, NULL, NULL, 'NO'),
    ('fuel_product', 'character varying', NULL, NULL, 30, 'NO'),
    ('region', 'character varying', NULL, NULL, 100, 'NO'),
    ('currency', 'character', NULL, NULL, 3, 'NO'),
    ('unit', 'character varying', NULL, NULL, 10, 'NO'),
    ('reference_price', 'numeric', 10, 2, NULL, 'NO'),
    ('prior_price', 'numeric', 10, 2, NULL, 'YES'),
    ('announced_at', 'timestamp with time zone', NULL, NULL, NULL, 'YES'),
    ('effective_at', 'timestamp with time zone', NULL, NULL, NULL, 'NO'),
    ('fetched_at', 'timestamp with time zone', NULL, NULL, NULL, 'YES'),
    ('source_url', 'text', NULL, NULL, NULL, 'NO'),
    ('verification_method', 'character varying', NULL, NULL, 20, 'NO'),
    ('lifecycle', 'character varying', NULL, NULL, 20, 'NO'),
    ('source_hash', 'character varying', NULL, NULL, 128, 'YES'),
    ('verified_by', 'integer', NULL, NULL, NULL, 'YES')
  ) AS expected(name, type_name, precision_value, scale_value, max_length, nullable)
  LEFT JOIN information_schema.columns AS actual ON actual.table_schema = 'public'
    AND actual.table_name = 'fuel_price_snapshots' AND actual.column_name = expected.name
  WHERE actual.column_name IS NULL OR actual.data_type <> expected.type_name
    OR (expected.precision_value IS NOT NULL AND actual.numeric_precision IS DISTINCT FROM expected.precision_value)
    OR (expected.scale_value IS NOT NULL AND actual.numeric_scale IS DISTINCT FROM expected.scale_value)
    OR (expected.max_length IS NOT NULL AND actual.character_maximum_length IS DISTINCT FROM expected.max_length)
    OR actual.is_nullable <> expected.nullable;
  IF incompatible_columns IS NOT NULL THEN
    RAISE EXCEPTION '154: incompatible existing fuel price columns: %', incompatible_columns;
  END IF;
  SELECT * INTO effectivity_index FROM pg_index
    WHERE indexrelid = 'public.uq_fuel_price_snapshot_effectivity'::regclass;
  IF NOT FOUND OR effectivity_index.indrelid <> 'public.fuel_price_snapshots'::regclass
    OR NOT effectivity_index.indisunique OR NOT effectivity_index.indisvalid
    OR effectivity_index.indpred IS NOT NULL OR effectivity_index.indexprs IS NOT NULL
    OR effectivity_index.indnkeyatts <> 3 OR effectivity_index.indnatts <> 3
    OR effectivity_index.indkey::text <> (
      SELECT string_agg(attnum::text, ' ' ORDER BY position)
      FROM (VALUES ('fuel_product', 1), ('region', 2), ('effective_at', 3)) AS expected(name, position)
      JOIN pg_attribute ON attrelid = 'public.fuel_price_snapshots'::regclass AND attname = expected.name
    ) THEN
    RAISE EXCEPTION '154: effectivity index is incompatible, partial or invalid';
  END IF;
END $$;

-- No policies are created on purpose: snapshots are written by the service
-- role through the permission-gated manual API (a later Task 10 slice), and
-- the public anon key must reach nothing — not even an empty-table 200 that
-- reads as safe. Enabling RLS alone is not sufficient since TRUNCATE bypasses
-- row security, so the revoke below is load-bearing rather than decorative.
ALTER TABLE public.fuel_price_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.fuel_price_snapshots FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.fuel_price_snapshots FROM PUBLIC;

COMMIT;
