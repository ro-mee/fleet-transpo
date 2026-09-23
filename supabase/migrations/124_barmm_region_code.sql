BEGIN;

-- ============================================
-- MIGRATION 124: BARMM is region 19, not region 15
--
-- Migration 123 seeded the seventeenth region as `1500000000` with the name
-- "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)". The name is right
-- and the code is wrong.
--
-- `15` was ARMM — the Autonomous Region in Muslim Mindanao — which the
-- Bangsamoro Organic Law abolished in 2019. What replaced it is BARMM, and its
-- code is `1900000000`. Neither 123's own comment nor the rest of its seed
-- reaches for 15: the seed runs 01–14, then MIMAROPA at 17, then 16 for Caraga,
-- so 15 is simply the slot ARMM used to occupy, kept in place after the region
-- under it was replaced. 19 is the code the current source publishes, and the
-- 2017 jgngo export agrees by omitting BARMM entirely and leaving 15 as ARMM.
--
-- WHY THIS BLOCKS THE ENTIRE IMPORT, NOT JUST BARMM
-- -------------------------------------------------
-- `scripts/import-psgc.mjs` resolves EVERY stated parent — a province names its
-- region, a city names its region and province, a barangay names all three — and
-- rejects the whole file before writing anything if one does not resolve. Every
-- BARMM province, city and barangay names region 19. The table holds 15. So the
-- import fails as a unit: the other sixteen regions' ~42,000 rows are refused
-- because of a defect in one seeded row. That is the importer behaving correctly
-- — refusing to file a row under a parent it cannot find — and the fault is
-- entirely in the seed.
--
-- WHY THIS IS A MIGRATION AND NOT AN IMPORTER FIX
-- -----------------------------------------------
-- The converter (`scripts/psgc-normalize.mjs`) deliberately does NOT write
-- region rows: migration 123's region seed is the authority on regions, because
-- the importer's region upsert is `name = EXCLUDED.name` and a data file would
-- silently overwrite the display naming the address spec asks for. Carving out
-- an exception for the one row that is wrong would put two competing authorities
-- in the same table. The seed is wrong, so the seed is what gets corrected.
--
-- WHY A REWRITE OF A PRIMARY KEY IS SAFE HERE
-- -------------------------------------------
-- `ph_provinces.region_code` and `ph_cities.region_code` are the only foreign
-- keys into `ph_regions` (confirmed against `schema.sql`), and neither is
-- DEFERRABLE — so an UPDATE of the parent key with children still pointing at it
-- fails on the constraint mid-statement, with a message that says nothing about
-- the actual problem. The block below counts those children first and refuses
-- with a named reason, which keeps this transaction's failure legible instead of
-- obscure.
--
-- In the state this migration will actually meet, that count is zero: the four
-- geography tables are empty below Region, because the import has never
-- succeeded. The guard exists for the case where a later reader applies this
-- after some other route has populated the tree, and is a no-op otherwise.
--
-- Idempotent: guarded on the target code already being present, and both
-- statements match nothing when the work has already been done.
-- ============================================

DO $$
DECLARE
  under_armm integer;
BEGIN
  -- 1. Anything still hanging off the abolished code?
  --    Counted up front so the failure names the cause. The constraints are not
  --    deferrable, so without this check the UPDATE below would die on
  --    `ph_provinces_region_code_fkey` and leave an operator reading a foreign
  --    key error that does not mention BARMM, ARMM or migration 123.
  SELECT (SELECT count(*) FROM public.ph_provinces WHERE region_code = '1500000000')
       + (SELECT count(*) FROM public.ph_cities    WHERE region_code = '1500000000')
    INTO under_armm;

  IF under_armm > 0 THEN
    RAISE EXCEPTION
      'Cannot renumber region 15 to 19: % row(s) still reference 1500000000. '
      'Re-point them first (UPDATE ... SET region_code = ''1900000000''), then re-run.',
      under_armm;
  END IF;

  -- 2. If 19 is already present the correction has been made — by an earlier
  --    apply of this file, or by hand. Remove the leftover 15 so the Region
  --    dropdown cannot offer a region that no longer exists and that nothing can
  --    ever be filed under. Safe precisely because of the count above: no
  --    province and no city references it.
  IF EXISTS (SELECT 1 FROM public.ph_regions WHERE psgc_code = '1900000000') THEN
    DELETE FROM public.ph_regions WHERE psgc_code = '1500000000';
  ELSE
    -- 3. The correction. `updated_at` is set by the trigger migration 123 put on
    --    this table, so it is not assigned here.
    --
    --    The name is deliberately NOT touched. It is already the display form the
    --    address spec asks for, and it is this table — not the import file — that
    --    is the authority on region naming.
    UPDATE public.ph_regions
       SET psgc_code = '1900000000'
     WHERE psgc_code = '1500000000';
  END IF;
END $$;

COMMIT;
