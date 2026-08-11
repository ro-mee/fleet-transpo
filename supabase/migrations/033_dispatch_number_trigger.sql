-- ============================================
-- MIGRATION 033: Dispatch Number Auto-Generation
--
-- `dispatchschedules.dispatch_number` is NOT NULL + UNIQUE, and the helper
-- `generate_dispatch_number()` (001_schema.sql) existed but was never attached.
-- That meant every dispatch create had to supply its own number or the INSERT
-- failed. This wires the function to a BEFORE INSERT trigger so dispatch creates
-- (including the new assign -> dispatch auto-creation) get a
-- `DSP-XXXX` number for free (migration 034 redefines the generator to emit a
-- random suffix mirroring reservation numbers).
--
-- Fire only when the caller did not already provide a number (e.g. an external
-- tool that wants its own format), so the trigger is safe alongside explicit
-- supply. Idempotent: dropping/recreating the trigger is the safe re-run.
-- ============================================

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_dispatch_number ON dispatchschedules;
  CREATE TRIGGER trg_dispatch_number
    BEFORE INSERT ON dispatchschedules
    FOR EACH ROW
    WHEN (NEW.dispatch_number IS NULL)
    EXECUTE FUNCTION generate_dispatch_number();
END $$;