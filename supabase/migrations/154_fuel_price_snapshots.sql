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
  CONSTRAINT chk_fuel_snapshot_unit CHECK (unit = 'L')
);

-- Unique source/version/effectivity key: a repeated ingestion of the same
-- announcement is ignored by the constraint rather than stored twice. A
-- correction is a NEW row with a later effective_at, so historical instants
-- keep resolving to the price that was actually in effect then.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_price_snapshot_effectivity
  ON public.fuel_price_snapshots (fuel_product, region, effective_at);

-- No policies are created on purpose: snapshots are written by the service
-- role through the permission-gated manual API (a later Task 10 slice), and
-- the public anon key must reach nothing — not even an empty-table 200 that
-- reads as safe. Enabling RLS alone is not sufficient since TRUNCATE bypasses
-- row security, so the revoke below is load-bearing rather than decorative.
ALTER TABLE public.fuel_price_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.fuel_price_snapshots FROM anon, authenticated;

COMMIT;
