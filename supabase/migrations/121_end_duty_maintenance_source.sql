-- 121_end_duty_maintenance_source.sql
--
-- A second source of auto-generated maintenance work orders: a driver's
-- End Duty report (the post-shift "anything unusual with the vehicle?" answer).
--
-- The incident path already records where a work order came from and makes it
-- unique per source (063 adds the column, 083 makes it unique). An End Duty
-- report raises work orders the same way, so it needs the same two things and
-- nothing more.
--
-- The unique partial index is the load-bearing part, exactly as it is for
-- incidents: the End Duty submission can be retried (weak signal at the depot,
-- or a double tap), and the `ON CONFLICT DO NOTHING` in
-- ensureInspectionMaintenance only dedupes against an index it can actually
-- see. Without it a retry files the same fault twice and dispatch sees two
-- repairs for one complaint.
--
-- The nullable column keeps ordinary maintenance records unchanged — every
-- existing row, and every manually raised work order, stays NULL.
--
-- No backfill: no End Duty report exists yet, so there is nothing to link.
-- Deliberately no vehicleinspection.maintenance_id back-link — the reverse
-- lookup answers the same question, and the office already renders provenance
-- that way (maintenance/page.js shows "Incident #N" from source_incident_id).
--
-- Idempotent throughout.

BEGIN;

ALTER TABLE vehiclemaintenance
  ADD COLUMN IF NOT EXISTS source_inspection_id INT REFERENCES vehicleinspection(inspection_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiclemaintenance_source_inspection
  ON vehiclemaintenance(source_inspection_id)
  WHERE source_inspection_id IS NOT NULL;

COMMIT;
