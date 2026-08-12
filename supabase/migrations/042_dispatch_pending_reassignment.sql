-- ============================================
-- MIGRATION 033: Declare 'Pending Reassignment'
--
-- Purpose:
--   Bring the migration history in line with the
--   live database. chk_dispatch_status on
--   dnxuphhxlzidvwtdqqkq already allows five
--   values; migration 012 declares four. The
--   fifth, 'Pending Reassignment', was added
--   directly to the live DB and never written
--   down, so a replay from migrations produced a
--   schema that rejects a status the running
--   application sets.
--
--   Set by:   src/app/api/driver/incidents/route.js
--             (vehicle grounded mid-dispatch, so
--              vehicle_id and driver_id are
--              cleared and the dispatch parks here)
--   Cleared by: src/app/api/dispatch/[id]/route.js
--             (dispatcher reassigns resources,
--              status returns to 'Scheduled')
--
-- Idempotent: safe to run against the live DB,
-- where it drops and recreates an identical
-- constraint.
-- ============================================

BEGIN;

ALTER TABLE dispatchschedules
  DROP CONSTRAINT IF EXISTS chk_dispatch_status;

ALTER TABLE dispatchschedules
  ADD CONSTRAINT chk_dispatch_status
  CHECK (status IN (
    'Scheduled',
    'In Progress',
    'Completed',
    'Cancelled',
    'Pending Reassignment'
  ));

COMMIT;
