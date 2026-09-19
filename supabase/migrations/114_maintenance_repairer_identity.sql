-- Give the maintenance completion guard a real repairer to compare against.
--
-- The guard that said "Mechanics cannot approve their own repairs" compared
-- against created_by. On an incident-sourced work order created_by is the staff
-- member who RESOLVED THE INCIDENT (lib/incidents/maintenance.js passes
-- session.user.employeeId), not the person who did the work. So the guard denied
-- the very people who had opened the queue by triaging incidents, and a live
-- admin account (employee 48) could not complete any of its own work orders.
--
-- repair_completed_by is stamped on the transition into 'Pending Inspection' —
-- the moment the repair is declared finished. That is the actor the separation
-- of duties rule actually cares about.
--
-- Deliberately nullable with NO backfill: no existing row records who performed
-- the work, and inferring one from created_by is what caused the bug. The guard
-- simply does not fire for rows where the repairer is unknown.
ALTER TABLE vehiclemaintenance
  ADD COLUMN IF NOT EXISTS repair_completed_by INT REFERENCES employees(employee_id);

-- inspection_required is no longer read by anything. The completion gate that
-- consumed it was removed: no UI, service, or endpoint anywhere in the app could
-- write inspection_completed_at, so the gate could not be satisfied by a real
-- user — every record was blocked from Completed, and none had been completed
-- since migration 097 applied on 2026-09-04.
--
-- The columns stay (dropping them is irreversible, and a rejected/failed
-- inspection record may yet be wanted), but the DEFAULT must stop asserting a
-- live requirement that nothing enforces.
ALTER TABLE vehiclemaintenance
  ALTER COLUMN inspection_required SET DEFAULT FALSE;
