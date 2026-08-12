-- ============================================
-- MIGRATION 034: Dispatch Number Random Suffix
--
-- Change dispatch numbers from sequential `DSP-YYYYMMDD-NNNN` to a short,
-- random `DSP-XXXX` format that mirrors the reservation identifier layout
-- (`RS-XXXX`, see src/lib/scheduling/reservation-number.js). Dispatchers read
-- these aloud and type them into search, so a short fixed prefix + random
-- alphanumerics (no day padding) matches how reservations are now labelled.
--
-- Uses the same character set as reservation numbers
-- (`A-Z0-9`, no ambiguous letters removed). Uniqueness is backed by the
-- existing UNIQUE index on dispatchschedules.dispatch_number; the function
-- re-rolls on collision up to a small bound rather than failing the insert.
--
-- The BEFORE INSERT trigger (migration 033) still wires this function, so no
-- call-site changes are needed: any INSERT that omits dispatch_number gets a
-- `DSP-XXXX` value automatically.
-- ============================================

CREATE OR REPLACE FUNCTION generate_dispatch_number()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  suffix TEXT;
  attempt INT;
  ln INT;
BEGIN
  ln := length(chars);
  FOR attempt IN 1..50 LOOP
    suffix := '';
    FOR i IN 1..4 LOOP
      suffix := suffix || substr(chars, 1 + floor(random() * ln)::int, 1);
    END LOOP;
    NEW.dispatch_number := 'DSP-' || suffix;
    -- Collide with an existing row? Re-roll. The UNIQUE constraint is the
    -- final arbiter; this loop just short-circuits the common case.
    IF NOT EXISTS (SELECT 1 FROM dispatchschedules WHERE dispatch_number = NEW.dispatch_number) THEN
      RETURN NEW;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;