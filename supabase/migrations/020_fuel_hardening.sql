-- ============================================
-- MIGRATION 020: Fuel Review Workflow Hardening
--
-- Persistence and value-set guards for the fuel review workflow. The fuel
-- POST/PUT routes validate a rejection reason and an approval actor on every
-- review transition, but nothing persisted them: a rejected record could lose
-- its reason, and an approval left no audit trail. These columns close that
-- gap, and the CHECK below turns the status field from an open text column
-- into a closed value set so invalid statuses can never reach the table.
--
-- 1. rejection_reason TEXT — the driver-provided reason for a rejection. The
--    API validates it on transition to 'Rejected'; this column is where it
--    survives (previously validated then dropped, causing a 500).
-- 2. approved_by INT REFERENCES employees(employee_id) — who approved the
--    record, mirroring the reviewed_by/approved_by pattern already used by
--    the reservation module (migration 016).
-- 3. approved_at TIMESTAMPTZ — when the approval happened, so the audit trail
--    carries a timestamp rather than a bare actor id.
-- 4. chk_fuel_status CHECK (status IN ('Pending','Approved','Rejected',
--    'Completed')) — the value set the fuel workflow actually uses. The
--    existing column default is 'Completed', which passes; CHECK constraints
--    ignore NULLs, so a NULL status remains legal.
--
-- Rollback: three DROP COLUMN statements and one DROP CONSTRAINT.
-- ============================================

BEGIN;

ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES employees(employee_id);
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ADD CONSTRAINT has no IF NOT EXISTS, so guard on the catalog to keep the
-- migration re-appliable in line with the rest of the directory.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_fuel_status'
  ) THEN
    ALTER TABLE fuelrecords ADD CONSTRAINT chk_fuel_status
      CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed'));
  END IF;
END $$;

COMMIT;
