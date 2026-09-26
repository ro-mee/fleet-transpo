-- The Vehicle Problem Queue's access path. (Plan task 9; version renumbered from
-- 127 -> 128 -> 131 by `npm run db:status` at execution time — 127 went to a
-- concurrent workstream's notifications retention, 128 to the mobile refresh-token
-- purge, 130 is spent in the ledger with no file on disk.)
--
-- The queue's predicate is `status = 'Failed' OR (inspection_type = 'Post-Shift'
-- AND status = 'Reported')`, and the role dashboard runs its COUNT form on every
-- dashboard load for admin and fleet_manager. The two indexes that already exist
-- on vehicleinspection are keyed on (trip_id, ...) and (vehicle_id, ...), so
-- neither can serve a filter on status / inspection_type: this would be a
-- sequential scan over the whole table on the hottest page in the app.
--
-- Partial, because the queue only ever reads the flagged rows — a passed
-- inspection is invisible to it by construction, so pay for the flagged ones
-- only. Mirrors the shape of uq_vehicleinspection_driver_submission (migration
-- 121), the table's other partial index.
--
-- No RLS or GRANT work belongs here: an index is not a table, a view or a
-- function, so none of the exposures AGENTS.md warns about apply to it — it is
-- not reachable through PostgREST and grants cannot be attached to it. It also
-- needs no entry in scripts/lib/schema-contract.mjs, which registers tables and
-- views only.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_vehicleinspection_problem_queue
  ON public.vehicleinspection (inspection_date DESC, inspection_id DESC)
  WHERE status = 'Failed'
     OR (inspection_type = 'Post-Shift' AND status = 'Reported');

COMMIT;
