-- One maintenance work order per incident, including archived rows.
-- The nullable source_incident_id keeps ordinary maintenance records unchanged.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiclemaintenance_source_incident
  ON vehiclemaintenance(source_incident_id)
  WHERE source_incident_id IS NOT NULL;

COMMIT;
