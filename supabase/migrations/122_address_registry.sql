BEGIN;

-- ============================================
-- MIGRATION 122: the address registry
--
-- One normalized home for every physical address in the application. Before
-- this, an address was free text in five different places, and the only thing
-- resembling validation was an operator pasting a Google Maps URL that the
-- server scraped coordinates out of (src/lib/google-maps.js).
--
-- WHY ONE TABLE RATHER THAN A LAT/LNG PAIR PER ENTITY
-- ---------------------------------------------------
-- The obvious move is `locations_address_latitude`, `drivers_address_latitude`,
-- `emergency_address_latitude` — a pair of columns on each table that has an
-- address. That is rejected here, because it makes "Address B with Latitude A"
-- representable: nothing in the schema ties a coordinate to the address it was
-- derived from, so a form that updates the text without updating the pair
-- writes a row that is wrong in a way no constraint can catch.
--
-- Here the text, the components, the ZIP, the coordinate and the verified flag
-- are ONE row. An entity holds a foreign key to it. There is no arrangement of
-- columns in which half of an address can be updated without the other half,
-- because they are not separable.
--
-- WHAT EACH COLUMN IS FOR — these stay INDEPENDENT
-- ------------------------------------------------
--   raw_input          exactly what the operator typed, preserved even when
--                      the provider resolves it to something tidier.
--   formatted_address  the provider's own rendering. Authoritative for display.
--   street_* .. region the structured components. Never guessed: a component
--                      the provider did not send stays NULL ("Do not force
--                      every Philippine address into an incorrect format").
--   postal_code        INDEPENDENT of `verified`. A verified location with no
--                      ZIP is a normal outcome, not a failure, and the UI has
--                      to be able to show "Location verified" next to "ZIP code
--                      not provided". Never invented when the provider is
--                      silent.
--   postal_code_source 'provider' | 'manual'. A manual ZIP is the operator's
--                      own assertion and survives re-geocoding; a provider ZIP
--                      belongs to the address that produced it and is replaced.
--   latitude/longitude NULL together or present together — enforced below.
--   verified           set only from a provider answer, never from a client.
--                      src/lib/address/validate.js discards any `verified`
--                      that arrives in a request body.
--
-- NOTHING HERE IS BACKFILLED, AND NOTHING IS GEOCODED IN BULK
-- -----------------------------------------------------------
-- Existing rows keep `address_id = NULL` and continue to read from their
-- existing text columns exactly as before. The columns added below are nullable
-- for that reason. A row is upgraded only when a human next edits it. Geocoding
-- the whole database would spend API quota at an unknown rate against addresses
-- whose accuracy and privacy have not been reviewed — deliberately not done
-- here, and not a follow-up this migration implies.
--
-- WHY THIS IS SAFE FOR THE APPLICATION
-- ------------------------------------
--   * Every added column is NULLABLE, so no existing INSERT changes meaning.
--   * ON DELETE SET NULL on every foreign key: locations are retired rather
--     than deleted today (no DELETE handler exists, and no code issues
--     `DELETE FROM locations`), but if one ever is, the referencing row keeps
--     its own text columns instead of the delete failing on a constraint that
--     did not exist before this migration.
--   * `locations` keeps its own address/latitude/longitude columns as a
--     MAINTAINED DENORMALIZATION, not as a second source of truth. The
--     `addresses` row is authoritative; those columns are a read cache so the
--     geofence and route-resolver hot paths do not grow a join. This is the
--     same shape `routes.origin` already has against `origin_location_id`
--     (migration 076), so it is idiomatic here rather than novel.
--
-- RLS IS MANDATORY, AND IS NOT SUFFICIENT ON ITS OWN
-- --------------------------------------------------
-- Migration 100 enabled RLS on a fixed list of 20 tables. That was a one-time
-- list, not a standing rule — tables created afterwards do NOT inherit it, which
-- is exactly how app_errors, ai_prompt_templates and trip_monitor_alerts ended
-- up readable with the public anon key (SEC-DB-003).
--
-- So this table enables RLS explicitly, AND revokes the grants, because row
-- security does not apply to TRUNCATE: a table with RLS on and an anon TRUNCATE
-- grant is still one statement away from being emptied by anyone holding the
-- key that ships in the browser bundle. The table is a registry of home
-- addresses and emergency-contact addresses, so that is not a theoretical
-- concern.
--
-- Idempotent throughout: IF NOT EXISTS on the table, the columns and the
-- indexes; DROP TRIGGER IF EXISTS before CREATE TRIGGER; REVOKE of a privilege
-- not held is a no-op. The sequence revoke is guarded because the live database
-- is ahead of the files in places, and a pre-existing `addresses` table would
-- not necessarily own a sequence of this name.
-- ============================================

CREATE TABLE IF NOT EXISTS public.addresses (
  address_id          serial PRIMARY KEY,

  raw_input           text,
  formatted_address   text NOT NULL,

  street_number       varchar(50),
  street_name         varchar(255),
  unit_number         varchar(50),
  building            varchar(255),
  subdivision         varchar(255),
  barangay            varchar(255),
  city                varchar(255),
  municipality        varchar(255),
  province            varchar(255),
  region              varchar(255),

  postal_code         varchar(16),
  postal_code_source  varchar(16),
  country             varchar(100) DEFAULT 'Philippines',

  latitude            numeric(10,7),
  longitude           numeric(10,7),

  provider            varchar(32),
  provider_place_id   text,

  verified            boolean NOT NULL DEFAULT false,
  verified_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Half a coordinate is worse than none: it reads as "located" to every
  -- downstream consumer while being unusable for navigation. The pair is
  -- all-or-nothing, and in range when present.
  CONSTRAINT chk_addresses_coords_pair CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180)
  ),

  -- A row in the address registry always describes something. A cleared address
  -- is expressed by setting the referencing column to NULL, never by writing a
  -- blank row that later reads as "this driver has an address".
  CONSTRAINT chk_addresses_formatted_not_blank CHECK (btrim(formatted_address) <> '')
);

-- Entities point at the registry. Nothing gets its own lat/lng pair.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS address_id integer REFERENCES public.addresses(address_id) ON DELETE SET NULL;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS address_id integer REFERENCES public.addresses(address_id) ON DELETE SET NULL;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS emergency_contact_address_id integer REFERENCES public.addresses(address_id) ON DELETE SET NULL;

-- Reservations have always stored the pickup/drop-off location as a NAME with
-- no link to the location registry, so renaming a location silently orphans a
-- reservation's reference to it. These columns are the durable link; the
-- existing text columns remain as the historical record and the fallback for
-- requests ingested from outside the app.
ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS pickup_location_id integer REFERENCES public.locations(location_id) ON DELETE SET NULL;

ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS dropoff_location_id integer REFERENCES public.locations(location_id) ON DELETE SET NULL;

-- Every foreign key is indexed: without this, a delete or update on the
-- referenced table sequentially scans the referencing one to enforce the
-- constraint.
CREATE INDEX IF NOT EXISTS idx_locations_address_id                  ON public.locations (address_id);
CREATE INDEX IF NOT EXISTS idx_drivers_address_id                    ON public.drivers (address_id);
CREATE INDEX IF NOT EXISTS idx_drivers_ec_address_id                 ON public.drivers (emergency_contact_address_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_pickup_location_id ON public.transportation_requests (pickup_location_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_dropoff_location_id ON public.transportation_requests (dropoff_location_id);

-- Partial index: the operational surfaces only ever ask for the verified ones.
CREATE INDEX IF NOT EXISTS idx_addresses_verified ON public.addresses (verified) WHERE verified;

-- `updated_at` is maintained by the shared trigger function from migration 001,
-- the same one every other mutable table uses. DROP-then-CREATE because
-- Postgres has no CREATE TRIGGER IF NOT EXISTS.
DROP TRIGGER IF EXISTS update_addresses_updated_at ON public.addresses;
CREATE TRIGGER update_addresses_updated_at
  BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS on, and the grant path closed too. See the header: enabling row security
-- alone leaves TRUNCATE reachable through the public anon key.
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON public.addresses FROM anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.addresses_address_id_seq') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON SEQUENCE public.addresses_address_id_seq FROM anon, authenticated;
  END IF;
END $$;

COMMIT;
