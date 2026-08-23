-- 063_vehiclemaintenance_source_incident.sql
--
-- First-class linkage between emergency repairs and the incident that caused
-- them. Until now the only connection was free text ("Emergency repair
-- generated from Incident #7: ...") written by the atomic
-- POST /api/incidents/[id]/maintenance endpoint, so the register could not
-- answer "which repairs came from incidents?" or notify anyone when the work
-- finished.
--
-- Backfills existing incident-generated rows from that exact description
-- prefix, guarded by EXISTS so a reference to a since-vanished incident can
-- never violate the new FK.
--
-- Idempotent throughout.

BEGIN;

ALTER TABLE vehiclemaintenance
  ADD COLUMN IF NOT EXISTS source_incident_id INT REFERENCES driverincidents(incident_id);

CREATE INDEX IF NOT EXISTS idx_vehiclemaintenance_source_incident
  ON vehiclemaintenance(source_incident_id)
  WHERE source_incident_id IS NOT NULL;

UPDATE vehiclemaintenance
   SET source_incident_id = (regexp_match(description, 'generated from Incident #(\d+)'))[1]::int
 WHERE deleted_at IS NULL
   AND source_incident_id IS NULL
   AND description ~ '^Emergency repair generated from Incident #\d+:'
   AND EXISTS (
     SELECT 1 FROM driverincidents i
      WHERE i.incident_id = (regexp_match(description, 'generated from Incident #(\d+)'))[1]::int
   );

COMMIT;
