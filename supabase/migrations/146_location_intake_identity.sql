BEGIN;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS location_code UUID DEFAULT uuid_generate_v4();

ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS partner_pickup_location_proposal JSONB,
  ADD COLUMN IF NOT EXISTS partner_dropoff_location_proposal JSONB;

-- Existing objects are accepted only when they already match this contract.
DO $$
DECLARE
  location_code_type text;
  location_code_default text;
  catalog_location_code_default text;
  valid_proposal_columns integer;
BEGIN
  SELECT data_type, column_default
    INTO location_code_type, location_code_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'locations'
     AND column_name = 'location_code';

  IF location_code_type IS DISTINCT FROM 'uuid'
     OR location_code_default IS DISTINCT FROM 'uuid_generate_v4()' THEN
    RAISE EXCEPTION 'locations.location_code conflicts with the required UUID DEFAULT uuid_generate_v4()';
  END IF;

  SELECT pg_get_expr(default_definition.adbin, default_definition.adrelid)
    INTO catalog_location_code_default
    FROM pg_attribute AS location_code_attribute
    LEFT JOIN pg_attrdef AS default_definition
      ON default_definition.adrelid = location_code_attribute.attrelid
     AND default_definition.adnum = location_code_attribute.attnum
   WHERE location_code_attribute.attrelid = 'public.locations'::regclass
     AND location_code_attribute.attname = 'location_code'
     AND NOT location_code_attribute.attisdropped;

  IF catalog_location_code_default IS DISTINCT FROM 'uuid_generate_v4()' THEN
    RAISE EXCEPTION 'locations.location_code has an unexpected catalog default';
  END IF;

  SELECT count(*)
    INTO valid_proposal_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'transportation_requests'
     AND column_name IN (
       'partner_pickup_location_proposal',
       'partner_dropoff_location_proposal'
     )
     AND data_type = 'jsonb'
     AND is_nullable = 'YES'
     AND column_default IS NULL;

  IF valid_proposal_columns <> 2 THEN
    RAISE EXCEPTION 'transportation_requests partner proposal columns conflict with the nullable JSONB contract';
  END IF;
END $$;

-- Only location_code is updated; existing location_id values, names, addresses,
-- coordinate points, activity state, and historical foreign keys remain untouched.
UPDATE public.locations
   SET location_code = uuid_generate_v4()
 WHERE location_code IS NULL;

ALTER TABLE public.locations
  ALTER COLUMN location_code SET NOT NULL;

-- Deliberately full-table: retired location codes remain reserved forever.
CREATE UNIQUE INDEX IF NOT EXISTS locations_location_code_uq
  ON public.locations (location_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS index_relation
      JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_index AS location_code_index
        ON location_code_index.indexrelid = index_relation.oid
      JOIN pg_attribute AS location_code_attribute
        ON location_code_attribute.attrelid = location_code_index.indrelid
       AND location_code_attribute.attname = 'location_code'
       AND NOT location_code_attribute.attisdropped
     WHERE index_namespace.nspname = 'public'
       AND index_relation.relname = 'locations_location_code_uq'
       AND location_code_index.indrelid = 'public.locations'::regclass
       AND location_code_index.indisunique
       AND location_code_index.indisvalid
       AND location_code_index.indisready
       AND location_code_index.indpred IS NULL
       AND location_code_index.indexprs IS NULL
       AND location_code_index.indnatts = 1
       AND location_code_index.indnkeyatts = 1
       AND location_code_index.indkey[0] = location_code_attribute.attnum
  ) THEN
    RAISE EXCEPTION 'locations_location_code_uq conflicts with the required full unique locations(location_code) index';
  END IF;
END $$;

DO $$
DECLARE
  constraint_type "char";
  constraint_is_valid boolean;
  constraint_columns smallint[];
  constraint_definition text;
  proposal_attnum smallint;
BEGIN
  SELECT attnum
    INTO proposal_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.transportation_requests'::regclass
     AND attname = 'partner_pickup_location_proposal'
     AND NOT attisdropped;

  SELECT contype, convalidated, conkey, pg_get_constraintdef(oid)
    INTO constraint_type, constraint_is_valid, constraint_columns, constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'public.transportation_requests'::regclass
     AND conname = 'chk_transportation_requests_partner_pickup_location_proposal';

  IF NOT FOUND THEN
    ALTER TABLE public.transportation_requests
      ADD CONSTRAINT chk_transportation_requests_partner_pickup_location_proposal
      CHECK (
        partner_pickup_location_proposal IS NULL
        OR (
          jsonb_typeof(partner_pickup_location_proposal) = 'object'
          AND partner_pickup_location_proposal - ARRAY['address', 'latitude', 'longitude']::text[] = '{}'::jsonb
          AND (
            NOT (partner_pickup_location_proposal ? 'address')
            OR (
              jsonb_typeof(partner_pickup_location_proposal->'address') = 'string'
              AND char_length(partner_pickup_location_proposal->>'address') <= 2000
            )
          )
          AND (
            (
              (NOT (partner_pickup_location_proposal ? 'latitude') OR jsonb_typeof(partner_pickup_location_proposal->'latitude') = 'null')
              AND (NOT (partner_pickup_location_proposal ? 'longitude') OR jsonb_typeof(partner_pickup_location_proposal->'longitude') = 'null')
            )
            OR CASE
              WHEN jsonb_typeof(partner_pickup_location_proposal->'latitude') = 'number'
               AND jsonb_typeof(partner_pickup_location_proposal->'longitude') = 'number'
              THEN CASE
                WHEN (partner_pickup_location_proposal->>'latitude')::numeric = 'NaN'::numeric
                  OR (partner_pickup_location_proposal->>'longitude')::numeric = 'NaN'::numeric
                THEN FALSE
                ELSE (partner_pickup_location_proposal->>'latitude')::numeric BETWEEN -90 AND 90
                 AND (partner_pickup_location_proposal->>'longitude')::numeric BETWEEN -180 AND 180
              END
              ELSE FALSE
            END
          )
          AND (
            NULLIF(BTRIM(partner_pickup_location_proposal->>'address'), '') IS NOT NULL
            OR CASE
              WHEN jsonb_typeof(partner_pickup_location_proposal->'latitude') = 'number'
               AND jsonb_typeof(partner_pickup_location_proposal->'longitude') = 'number'
              THEN CASE
                WHEN (partner_pickup_location_proposal->>'latitude')::numeric = 'NaN'::numeric
                  OR (partner_pickup_location_proposal->>'longitude')::numeric = 'NaN'::numeric
                THEN FALSE
                ELSE (partner_pickup_location_proposal->>'latitude')::numeric BETWEEN -90 AND 90
                 AND (partner_pickup_location_proposal->>'longitude')::numeric BETWEEN -180 AND 180
              END
              ELSE FALSE
            END
          )
        )
      );
  ELSIF constraint_type IS DISTINCT FROM 'c'
     OR constraint_is_valid IS DISTINCT FROM TRUE
     OR constraint_columns IS DISTINCT FROM ARRAY[proposal_attnum]::smallint[]
     OR constraint_definition !~* 'jsonb_typeof'
     OR constraint_definition !~* 'array\[.*address.*latitude.*longitude'
     OR constraint_definition !~* 'char_length'
     OR constraint_definition !~* '2000'
     OR constraint_definition !~* '-90'
     OR constraint_definition !~* '90'
     OR constraint_definition !~* '-180'
     OR constraint_definition !~* '180'
     OR constraint_definition !~* 'NaN'
     OR constraint_definition !~* 'btrim'
     OR constraint_definition !~* 'latitude'
     OR constraint_definition !~* 'longitude' THEN
    RAISE EXCEPTION 'chk_transportation_requests_partner_pickup_location_proposal conflicts with the required proposal validation';
  END IF;
END $$;

DO $$
DECLARE
  constraint_type "char";
  constraint_is_valid boolean;
  constraint_columns smallint[];
  constraint_definition text;
  proposal_attnum smallint;
BEGIN
  SELECT attnum
    INTO proposal_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.transportation_requests'::regclass
     AND attname = 'partner_dropoff_location_proposal'
     AND NOT attisdropped;

  SELECT contype, convalidated, conkey, pg_get_constraintdef(oid)
    INTO constraint_type, constraint_is_valid, constraint_columns, constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'public.transportation_requests'::regclass
     AND conname = 'chk_transportation_requests_partner_dropoff_location_proposal';

  IF NOT FOUND THEN
    ALTER TABLE public.transportation_requests
      ADD CONSTRAINT chk_transportation_requests_partner_dropoff_location_proposal
      CHECK (
        partner_dropoff_location_proposal IS NULL
        OR (
          jsonb_typeof(partner_dropoff_location_proposal) = 'object'
          AND partner_dropoff_location_proposal - ARRAY['address', 'latitude', 'longitude']::text[] = '{}'::jsonb
          AND (
            NOT (partner_dropoff_location_proposal ? 'address')
            OR (
              jsonb_typeof(partner_dropoff_location_proposal->'address') = 'string'
              AND char_length(partner_dropoff_location_proposal->>'address') <= 2000
            )
          )
          AND (
            (
              (NOT (partner_dropoff_location_proposal ? 'latitude') OR jsonb_typeof(partner_dropoff_location_proposal->'latitude') = 'null')
              AND (NOT (partner_dropoff_location_proposal ? 'longitude') OR jsonb_typeof(partner_dropoff_location_proposal->'longitude') = 'null')
            )
            OR CASE
              WHEN jsonb_typeof(partner_dropoff_location_proposal->'latitude') = 'number'
               AND jsonb_typeof(partner_dropoff_location_proposal->'longitude') = 'number'
              THEN CASE
                WHEN (partner_dropoff_location_proposal->>'latitude')::numeric = 'NaN'::numeric
                  OR (partner_dropoff_location_proposal->>'longitude')::numeric = 'NaN'::numeric
                THEN FALSE
                ELSE (partner_dropoff_location_proposal->>'latitude')::numeric BETWEEN -90 AND 90
                 AND (partner_dropoff_location_proposal->>'longitude')::numeric BETWEEN -180 AND 180
              END
              ELSE FALSE
            END
          )
          AND (
            NULLIF(BTRIM(partner_dropoff_location_proposal->>'address'), '') IS NOT NULL
            OR CASE
              WHEN jsonb_typeof(partner_dropoff_location_proposal->'latitude') = 'number'
               AND jsonb_typeof(partner_dropoff_location_proposal->'longitude') = 'number'
              THEN CASE
                WHEN (partner_dropoff_location_proposal->>'latitude')::numeric = 'NaN'::numeric
                  OR (partner_dropoff_location_proposal->>'longitude')::numeric = 'NaN'::numeric
                THEN FALSE
                ELSE (partner_dropoff_location_proposal->>'latitude')::numeric BETWEEN -90 AND 90
                 AND (partner_dropoff_location_proposal->>'longitude')::numeric BETWEEN -180 AND 180
              END
              ELSE FALSE
            END
          )
        )
      );
  ELSIF constraint_type IS DISTINCT FROM 'c'
     OR constraint_is_valid IS DISTINCT FROM TRUE
     OR constraint_columns IS DISTINCT FROM ARRAY[proposal_attnum]::smallint[]
     OR constraint_definition !~* 'jsonb_typeof'
     OR constraint_definition !~* 'array\[.*address.*latitude.*longitude'
     OR constraint_definition !~* 'char_length'
     OR constraint_definition !~* '2000'
     OR constraint_definition !~* '-90'
     OR constraint_definition !~* '90'
     OR constraint_definition !~* '-180'
     OR constraint_definition !~* '180'
     OR constraint_definition !~* 'NaN'
     OR constraint_definition !~* 'btrim'
     OR constraint_definition !~* 'latitude'
     OR constraint_definition !~* 'longitude' THEN
    RAISE EXCEPTION 'chk_transportation_requests_partner_dropoff_location_proposal conflicts with the required proposal validation';
  END IF;
END $$;

COMMIT;
