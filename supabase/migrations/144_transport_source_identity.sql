-- Prepared only; never applied as part of Task 1. Rollback requires first resolving
-- duplicate external_booking_id values across sources; do not blindly restore old unique.
-- Keep archived external_booking_id unchanged for existing PMS and other archived rows.
ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS external_request_id varchar(255),
  ADD COLUMN IF NOT EXISTS external_create_fingerprint varchar(64);

UPDATE public.transportation_requests
   SET external_request_id = external_booking_id
 WHERE external_request_id IS NULL AND external_booking_id IS NOT NULL;

-- Existing global UNIQUE(external_booking_id) prevents PMS:123 and POS:123.
-- Check the catalog before dropping: dependency failures must abort the transaction.
ALTER TABLE public.transportation_requests
  DROP CONSTRAINT IF EXISTS transportation_requests_external_booking_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS transportation_requests_source_request_uq
  ON public.transportation_requests (source_system, external_request_id);

-- IF NOT EXISTS only compares names: reject a same-named but wrong/partial index.
-- Also reject any surviving single-column global booking ID uniqueness, regardless
-- of its name or predicate, since it would still block PMS:123 alongside POS:123.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute src ON src.attrelid = tbl.oid AND src.attname = 'source_system'
    JOIN pg_attribute ext ON ext.attrelid = tbl.oid AND ext.attname = 'external_request_id'
    WHERE ns.nspname = 'public' AND idx.relnamespace = ns.oid
      AND tbl.relname = 'transportation_requests'
      AND idx.relname = 'transportation_requests_source_request_uq'
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indkey[0] = src.attnum AND i.indkey[1] = ext.attnum
  ) THEN
    RAISE EXCEPTION 'Source request uniqueness index is missing or has wrong keys/predicate';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute ext ON ext.attrelid = tbl.oid AND ext.attname = 'external_booking_id'
    WHERE ns.nspname = 'public' AND tbl.relname = 'transportation_requests'
      AND i.indisunique AND i.indnkeyatts = 1 AND i.indexprs IS NULL
      AND i.indkey[0] = ext.attnum
  ) THEN
    RAISE EXCEPTION 'A global booking ID uniqueness index still exists; review dependencies before cutover';
  END IF;
END $$;

-- Legacy nullable external booking IDs remain valid for locally-created requests.
-- FULL composite uniqueness: no WHERE deleted_at IS NULL partial predicate.
-- A non-null (source_system, external_request_id) is never reusable, including
-- after soft deletion; replays of tombstoned identities receive HTTP 409.
