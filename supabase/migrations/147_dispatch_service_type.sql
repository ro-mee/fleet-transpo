BEGIN;

-- Preserve the existing passenger request path while giving dispatch rows an
-- explicit discriminator for future shared cargo reservations. Historical
-- requestless rows remain NULL rather than being assigned a guessed purpose.
ALTER TABLE public.dispatchschedules
  ADD COLUMN IF NOT EXISTS service_type varchar(32);

UPDATE public.dispatchschedules
   SET service_type = 'PASSENGER'
 WHERE service_type IS NULL
   AND request_id IS NOT NULL;

ALTER TABLE public.dispatchschedules
  ALTER COLUMN service_type SET DEFAULT 'PASSENGER';

ALTER TABLE public.dispatchschedules
  DROP CONSTRAINT IF EXISTS chk_dispatch_service_type;

ALTER TABLE public.dispatchschedules
  ADD CONSTRAINT chk_dispatch_service_type
  CHECK (service_type IS NULL OR service_type IN ('PASSENGER', 'SUPPLY_DELIVERY'));

COMMENT ON COLUMN public.dispatchschedules.service_type IS
  'Operational work type sharing the dispatch resource slot. PASSENGER is the existing request-backed flow; SUPPLY_DELIVERY is reserved for the shipment allocation workflow. NULL is retained for historical requestless rows with unknown purpose.';

COMMIT;
