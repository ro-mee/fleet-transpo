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

-- Legacy nullable external booking IDs remain valid for locally-created requests.
-- FULL composite uniqueness: no WHERE deleted_at IS NULL partial predicate.
-- A non-null (source_system, external_request_id) is never reusable, including
-- after soft deletion; replays of tombstoned identities receive HTTP 409.
