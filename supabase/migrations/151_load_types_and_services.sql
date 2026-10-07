BEGIN;

-- Prepared only; renumbered from 145 after the authorized ledger check on 2026-10-07.
-- Do not apply until 150_transport_source_identity.sql is reconciled,
-- and the migration ledger is rechecked. No live DB writes were performed for Task 2.
-- Existing requests remain explicitly legacy (NULL load_type). New intake writes Passenger/Cargo.
ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS load_type varchar(20),
  ADD COLUMN IF NOT EXISTS cargo_weight_kg numeric(12, 3),
  ADD COLUMN IF NOT EXISTS cargo_description text,
  ADD COLUMN IF NOT EXISTS source_department text;

ALTER TABLE public.transportation_requests
  ALTER COLUMN passenger_count DROP DEFAULT,
  ALTER COLUMN passenger_count DROP NOT NULL,
  ALTER COLUMN load_type DROP DEFAULT,
  ALTER COLUMN load_type DROP NOT NULL;

-- Fail atomically rather than silently rewriting historical passenger counts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transportation_requests
    WHERE (load_type IS NULL OR load_type = 'Passenger')
      AND (passenger_count IS NULL OR passenger_count <= 0)
  ) THEN
    RAISE EXCEPTION 'Existing passenger_count requires explicit historical review before typed-load CHECK';
  END IF;
END $$;

ALTER TABLE public.service_types
  ADD COLUMN IF NOT EXISTS service_code varchar(80),
  ADD COLUMN IF NOT EXISTS default_load_type varchar(20);

CREATE UNIQUE INDEX IF NOT EXISTS service_types_service_code_unique
  ON public.service_types (service_code);

-- IF NOT EXISTS can otherwise accept an unrelated same-named index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attname = 'service_code'
    WHERE ns.nspname = 'public' AND tbl.relname = 'service_types'
      AND idx.relname = 'service_types_service_code_unique'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = 1
      AND i.indnatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indkey[0] = a.attnum
  ) THEN
    RAISE EXCEPTION 'service_types_service_code_unique is not the required full unique index';
  END IF;
END $$;

DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_service_default_load_type ON COMMIT DROP AS
  SELECT service_code, default_load_type
    FROM public.service_types
   WITH NO DATA;
  ALTER TABLE pg_temp._expected_service_default_load_type
    ADD CONSTRAINT _expected_service_default_load_type_check CHECK (
      (service_code IS NULL OR default_load_type IS NOT NULL)
      AND (default_load_type IS NULL OR default_load_type IN ('Passenger', 'Cargo'))
    );
  SELECT pg_get_constraintdef(oid)
    INTO expected_constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'pg_temp._expected_service_default_load_type'::regclass
     AND conname = '_expected_service_default_load_type_check';
  SELECT pg_get_constraintdef(oid), convalidated
    INTO constraint_definition, constraint_is_valid
    FROM pg_constraint
   WHERE conrelid = 'public.service_types'::regclass
     AND conname = 'chk_service_default_load_type';

  IF constraint_definition IS NULL THEN
    ALTER TABLE public.service_types
      ADD CONSTRAINT chk_service_default_load_type CHECK (
        (service_code IS NULL OR default_load_type IS NOT NULL)
        AND (default_load_type IS NULL OR default_load_type IN ('Passenger', 'Cargo'))
      );
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition
     OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_service_default_load_type exists with a mismatched or unvalidated definition';
  END IF;
END $$;

-- Do not manufacture a second display name beside an unclassified historical row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('Guest Transport', 'GUEST_TRANSPORT'),
      ('VIP Guest Transport', 'VIP_GUEST_TRANSPORT'),
      ('Restaurant Supply Pickup', 'RESTAURANT_SUPPLY_PICKUP'),
      ('Restaurant Food Delivery', 'RESTAURANT_FOOD_DELIVERY'),
      ('Hotel Supply Transfer', 'HOTEL_SUPPLY_TRANSFER')
    ) AS expected(service_name, service_code)
    JOIN public.service_types st ON st.service_name = expected.service_name
    WHERE st.service_code IS DISTINCT FROM expected.service_code
  ) THEN
    RAISE EXCEPTION 'Canonical service name already exists without expected code; review historical catalog';
  END IF;
END $$;

-- Unknown/custom historical services remain unclassified; their identifiers and FKs survive.
INSERT INTO public.service_types (service_name, service_code, default_load_type, description, status)
VALUES
  ('Guest Transport', 'GUEST_TRANSPORT', 'Passenger', 'Hotel guest passenger transport', 'Active'),
  ('VIP Guest Transport', 'VIP_GUEST_TRANSPORT', 'Passenger', 'VIP guest passenger transport', 'Active'),
  ('Restaurant Supply Pickup', 'RESTAURANT_SUPPLY_PICKUP', 'Cargo', 'Restaurant supply collection', 'Active'),
  ('Restaurant Food Delivery', 'RESTAURANT_FOOD_DELIVERY', 'Cargo', 'Restaurant prepared food delivery', 'Active'),
  ('Hotel Supply Transfer', 'HOTEL_SUPPLY_TRANSFER', 'Cargo', 'Hotel supplies and equipment transfer', 'Active')
ON CONFLICT DO NOTHING;

-- A conflicting preexisting code (wrong kind, name or disabled) must not be
-- silently treated as provisioned. Keep existing rows/FKs untouched and abort.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('GUEST_TRANSPORT', 'Guest Transport', 'Passenger'),
      ('VIP_GUEST_TRANSPORT', 'VIP Guest Transport', 'Passenger'),
      ('RESTAURANT_SUPPLY_PICKUP', 'Restaurant Supply Pickup', 'Cargo'),
      ('RESTAURANT_FOOD_DELIVERY', 'Restaurant Food Delivery', 'Cargo'),
      ('HOTEL_SUPPLY_TRANSFER', 'Hotel Supply Transfer', 'Cargo')
    ) AS expected(service_code, service_name, default_load_type)
    LEFT JOIN public.service_types st ON st.service_code = expected.service_code
    WHERE st.service_type_id IS NULL OR st.service_name <> expected.service_name
      OR st.default_load_type <> expected.default_load_type
      OR st.status IS DISTINCT FROM 'Active' OR st.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Canonical service code conflict; reconcile catalog before applying';
  END IF;
END $$;

-- Retire only explicitly excluded names; do not delete rows or rewrite historical FKs.
UPDATE public.service_types SET status = 'Inactive', updated_at = now()
 WHERE service_name IN ('Staff Transport', 'Employee Transport', 'Hotel Shuttle', 'Guest Shuttle')
   AND status IS DISTINCT FROM 'Inactive';

-- PostgreSQL NUMERIC NaN compares greater than ordinary numbers; > 0 alone
-- cannot prove a usable cargo weight when direct DB writers bypass the API.
DO $$
DECLARE
  constraint_definition text;
  expected_constraint_definition text;
  constraint_is_valid boolean;
BEGIN
  CREATE TEMP TABLE _expected_transport_typed_load ON COMMIT DROP AS
  SELECT load_type, passenger_count, cargo_weight_kg, cargo_description
    FROM public.transportation_requests
   WITH NO DATA;
  ALTER TABLE pg_temp._expected_transport_typed_load
    ADD CONSTRAINT _expected_transport_typed_load_check CHECK (
      (load_type IS NULL AND passenger_count IS NOT NULL AND passenger_count > 0
        AND cargo_weight_kg IS NULL AND cargo_description IS NULL)
      OR
      (load_type IS NOT NULL AND load_type = 'Passenger' AND passenger_count IS NOT NULL AND passenger_count > 0
        AND cargo_weight_kg IS NULL AND cargo_description IS NULL)
      OR
      (load_type IS NOT NULL AND load_type = 'Cargo' AND passenger_count IS NULL
        AND cargo_weight_kg IS NOT NULL AND cargo_weight_kg > 0
        AND cargo_weight_kg <> 'NaN'::numeric
        AND cargo_description IS NOT NULL AND btrim(cargo_description, E' \t\n\r\f' || chr(11)) <> '')
    );
  SELECT pg_get_constraintdef(oid)
    INTO expected_constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'pg_temp._expected_transport_typed_load'::regclass
     AND conname = '_expected_transport_typed_load_check';
  SELECT pg_get_constraintdef(oid), convalidated
    INTO constraint_definition, constraint_is_valid
    FROM pg_constraint
   WHERE conrelid = 'public.transportation_requests'::regclass
     AND conname = 'chk_transport_typed_load';

  IF constraint_definition IS NULL THEN
    ALTER TABLE public.transportation_requests
      ADD CONSTRAINT chk_transport_typed_load CHECK (
        (load_type IS NULL AND passenger_count IS NOT NULL AND passenger_count > 0
        AND cargo_weight_kg IS NULL AND cargo_description IS NULL)
      OR
      (load_type IS NOT NULL AND load_type = 'Passenger' AND passenger_count IS NOT NULL AND passenger_count > 0
          AND cargo_weight_kg IS NULL AND cargo_description IS NULL)
        OR
        (load_type IS NOT NULL AND load_type = 'Cargo' AND passenger_count IS NULL
          AND cargo_weight_kg IS NOT NULL AND cargo_weight_kg > 0
          AND cargo_weight_kg <> 'NaN'::numeric
          AND cargo_description IS NOT NULL AND btrim(cargo_description, E' \t\n\r\f' || chr(11)) <> '')
      );
  ELSIF constraint_definition IS DISTINCT FROM expected_constraint_definition
     OR constraint_is_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'chk_transport_typed_load exists with a mismatched or unvalidated definition';
  END IF;
END $$;

-- No historical request is silently enrolled into the typed fleet readiness gate.
COMMENT ON COLUMN public.transportation_requests.load_type IS
  'Explicit Passenger or Cargo request kind; not inferred from vehicle type text.';

COMMIT;
