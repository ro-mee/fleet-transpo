BEGIN;

-- ============================================
-- MIGRATION 123: PSGC geography for the cascading address form
--
-- The Philippine Standard Geographic Code hierarchy — Region → Province →
-- City/Municipality → Barangay — as four reference tables the address form picks
-- from instead of asking an operator to type an address freehand.
--
-- WHY THIS EXISTS, GIVEN `addresses` ALREADY STORES AN ADDRESS
-- -----------------------------------------------------------
-- Migration 122 gave every address one row with its components, and the address
-- validator fills those components from a geocoder. That path is correct but it
-- depends on a provider: TomTom's Search API answers 403 for the server key, so
-- the validator cannot resolve anything today. This migration takes the other
-- route to the same goal. When the operator PICKS Region, Province, City and
-- Barangay from the actual hierarchy, the address is structurally valid by
-- construction — with no provider anywhere in the path — and a geocoder becomes
-- a convenience rather than a dependency.
--
-- It also closes a hole the geocoder never could: a provider can confidently
-- place a pin at a barangay whose name appears in two cities, and nothing in the
-- schema would notice. A chosen PSGC code cannot be ambiguous.
--
-- WHY `ph_cities.province_code` IS NULLABLE — THIS IS LOAD-BEARING
-- ---------------------------------------------------------------
-- The hierarchy is NOT uniform. Metro Manila has no provinces at all: Manila,
-- Quezon City, Caloocan and the rest hang directly off the region. Several
-- highly urbanised cities sit outside a province for the same reason.
--
-- A NOT NULL province would force those rows into a fabricated province, which
-- is exactly the "do not force every Philippine address into an incorrect
-- standardized format" rule this codebase holds. `region_code` is therefore
-- present on EVERY row and is the column the cascade can always rely on, while
-- `province_code` is optional and its absence is meaningful data rather than
-- missing data. The form reads it: a region whose province list comes back empty
-- skips the province level instead of leaving it permanently disabled, which
-- would make every NCR address unsaveable.
--
-- WHY THE NAME INDEXES ARE ABSENT
-- -------------------------------
-- The obvious addition is `lower(name)` per level for type-to-filter. There is
-- deliberately none: filtering happens CLIENT-SIDE, over the one list the
-- dropdown already loaded (17 regions, ~10 provinces, tens of cities,
-- tens-to-hundreds of barangays). No query in this application searches these
-- tables by name, so such an index would be maintained on every write and read
-- by nothing. The indexes below cover the foreign keys, which ARE queried.
--
-- WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
-- --------------------------------------------
-- Regions only. They are few, stable and enumerable, and seeding them means the
-- form opens with a working Region dropdown rather than an empty one, so the
-- cascade can be seen to work before any import is run.
--
-- Provinces, cities and barangays are NOT seeded. They number in the thousands
-- and tens of thousands, and writing them from memory would assert specific
-- barangays that may not exist — the precise "never invent" failure this
-- codebase treats as a defect. They come from `scripts/import-psgc.mjs` and the
-- official PSA export, which is a prerequisite for the form to be useful rather
-- than something this migration pretends to have done.
--
-- The consequence is deliberate and visible: with only regions loaded, every
-- level below shows an empty state naming the cause. That is the honest state.
--
-- NIR (Negros Island Region) is also NOT seeded. It was abolished in 2017 and
-- re-established in 2024, so it is newer than the stable set below and its code
-- is not something to guess at. The import file supplies it.
--
-- RLS IS MANDATORY, AND IS NOT SUFFICIENT ON ITS OWN
-- --------------------------------------------------
-- Migration 100 enabled RLS on a fixed list of 20 tables. That was a one-time
-- list, not a standing rule — tables created afterwards do NOT inherit it, which
-- is how app_errors, ai_prompt_templates and trip_monitor_alerts ended up
-- readable with the public anon key (SEC-DB-003). So each of these four tables
-- enables RLS explicitly AND revokes the grants, because row security does not
-- apply to TRUNCATE. These tables are public reference data by nature, but
-- "public reference data" is not a reason to leave them writable or truncatable
-- through the key that ships in the browser bundle; the application reads them
-- over its own database connection as the owner role.
--
-- No sequence revoke is needed on these four: they use natural PSGC codes as
-- their primary keys, so no sequence is created.
--
-- Idempotent throughout: IF NOT EXISTS on tables, columns and indexes;
-- ON CONFLICT DO NOTHING on the seed, so re-running cannot duplicate a region or
-- clobber a name the import file has corrected.
-- ============================================

-- ── Regions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ph_regions (
  psgc_code   varchar(10)  PRIMARY KEY,
  name        varchar(255) NOT NULL,
  short_name  varchar(64),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ── Provinces ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ph_provinces (
  psgc_code    varchar(10)  PRIMARY KEY,
  region_code  varchar(10)  NOT NULL REFERENCES public.ph_regions (psgc_code) ON DELETE CASCADE,
  name         varchar(255) NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

-- ── Cities and municipalities ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ph_cities (
  psgc_code     varchar(10)  PRIMARY KEY,
  region_code   varchar(10)  NOT NULL REFERENCES public.ph_regions (psgc_code) ON DELETE CASCADE,
  -- NULL means "this city is not inside any province" — Metro Manila and the
  -- independent cities. NOT NULL would fabricate a province for them. See the
  -- header; this is the column the whole NCR path depends on.
  province_code varchar(10)  REFERENCES public.ph_provinces (psgc_code) ON DELETE CASCADE,
  name          varchar(255) NOT NULL,
  -- PSA distinguishes a chartered city from a municipality; both are valid
  -- inputs for "City / Municipality" and the form shows them in one list.
  is_city       boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- ── Barangays ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ph_barangays (
  psgc_code  varchar(10)  PRIMARY KEY,
  city_code  varchar(10)  NOT NULL REFERENCES public.ph_cities (psgc_code) ON DELETE CASCADE,
  name       varchar(255) NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- One per foreign key, because every cascade read filters on one of these and a
-- delete on the parent would otherwise sequentially scan the child.
CREATE INDEX IF NOT EXISTS idx_ph_provinces_region_code  ON public.ph_provinces (region_code);
CREATE INDEX IF NOT EXISTS idx_ph_cities_region_code     ON public.ph_cities (region_code);
CREATE INDEX IF NOT EXISTS idx_ph_cities_province_code   ON public.ph_cities (province_code);
CREATE INDEX IF NOT EXISTS idx_ph_barangays_city_code    ON public.ph_barangays (city_code);

-- ── updated_at, via the shared trigger function from migration 001 ───────────
-- DROP-then-CREATE because Postgres has no CREATE TRIGGER IF NOT EXISTS.
DROP TRIGGER IF EXISTS update_ph_regions_updated_at ON public.ph_regions;
CREATE TRIGGER update_ph_regions_updated_at
  BEFORE UPDATE ON public.ph_regions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_ph_provinces_updated_at ON public.ph_provinces;
CREATE TRIGGER update_ph_provinces_updated_at
  BEFORE UPDATE ON public.ph_provinces FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_ph_cities_updated_at ON public.ph_cities;
CREATE TRIGGER update_ph_cities_updated_at
  BEFORE UPDATE ON public.ph_cities FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_ph_barangays_updated_at ON public.ph_barangays;
CREATE TRIGGER update_ph_barangays_updated_at
  BEFORE UPDATE ON public.ph_barangays FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── The region seed: the 17 stable regions ───────────────────────────────────
-- `name` is the form that belongs in a written address — "CALABARZON (Region
-- IV-A)", not "Region IV-A" — because it is copied straight into
-- `addresses.region`. `short_name` is the compact alternative for tight UI.
--
-- DO NOTHING rather than DO UPDATE: if the import file has corrected a name, a
-- later re-run of this migration must not undo it.
INSERT INTO public.ph_regions (psgc_code, name, short_name) VALUES
  ('0100000000', 'Ilocos Region (Region I)',              'Region I'),
  ('0200000000', 'Cagayan Valley (Region II)',            'Region II'),
  ('0300000000', 'Central Luzon (Region III)',            'Region III'),
  ('0400000000', 'CALABARZON (Region IV-A)',              'Region IV-A'),
  ('1700000000', 'MIMAROPA Region (Region IV-B)',         'Region IV-B'),
  ('0500000000', 'Bicol Region (Region V)',               'Region V'),
  ('0600000000', 'Western Visayas (Region VI)',           'Region VI'),
  ('0700000000', 'Central Visayas (Region VII)',          'Region VII'),
  ('0800000000', 'Eastern Visayas (Region VIII)',         'Region VIII'),
  ('0900000000', 'Zamboanga Peninsula (Region IX)',       'Region IX'),
  ('1000000000', 'Northern Mindanao (Region X)',          'Region X'),
  ('1100000000', 'Davao Region (Region XI)',              'Region XI'),
  ('1200000000', 'SOCCSKSARGEN (Region XII)',             'Region XII'),
  ('1300000000', 'National Capital Region (NCR)',         'NCR'),
  ('1400000000', 'Cordillera Administrative Region (CAR)','CAR'),
  ('1500000000', 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)', 'BARMM'),
  ('1600000000', 'Caraga (Region XIII)',                  'Region XIII')
ON CONFLICT (psgc_code) DO NOTHING;

-- ── The columns `addresses` needs for a picked hierarchy ─────────────────────
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS address_type       varchar(16);
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS landmark           varchar(255);
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS additional_details text;

-- The chosen leaf of the PSGC hierarchy. This single code is what makes
-- SERVER-SIDE validation possible: the server resolves it to its region,
-- province and city from these tables and DERIVES those components from the
-- result, so a client cannot file "Balibago" under "Cebu City" — the city name
-- it sent is never read. The text columns on `addresses` stay as the
-- denormalised display copy, exactly as `locations.address` mirrors the registry
-- today. See `src/lib/address/validate-structured.js`.
--
-- ON DELETE SET NULL, not CASCADE: if a barangay is ever removed from the
-- reference data (PSGC churn is real — barangays are created and renamed by
-- plebiscite), the address must survive with its text intact. Cascading here
-- would delete a driver's home address because a code was retired.
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS psgc_barangay_code varchar(10)
  REFERENCES public.ph_barangays (psgc_code) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_psgc_barangay_code
  ON public.addresses (psgc_barangay_code);

-- ── RLS on, and the grant path closed too ────────────────────────────────────
-- See the header: enabling row security alone leaves TRUNCATE reachable through
-- the public anon key.
ALTER TABLE public.ph_regions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_cities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_barangays ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON public.ph_regions   FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.ph_provinces FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.ph_cities    FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.ph_barangays FROM anon, authenticated;

COMMIT;
