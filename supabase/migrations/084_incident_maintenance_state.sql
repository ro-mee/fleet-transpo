-- Persist the rule decision and the direct incident -> work-order link.
-- Existing open vehicle-related incidents receive one in-progress work order
-- so the new UI never leaves a live breakdown without a maintenance path.
BEGIN;

ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS requires_vehicle_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maintenance_id INT REFERENCES vehiclemaintenance(maintenance_id),
  ADD COLUMN IF NOT EXISTS maintenance_error TEXT;

UPDATE driverincidents
   SET requires_vehicle_maintenance = (
     vehicle_id IS NOT NULL
     AND (
       incident_type ~* '(breakdown|mechanical|engine|brake|flat tire|tire|tyre|battery|electrical|overheat|transmission|steering)'
       OR incident_type ~* '(vehicle damage|bodywork|bumper|windshield|transmission|steering)'
       OR (
         incident_type ~* '(accident|collision|crash)'
         AND (severity IN ('Major', 'Critical') OR description ~* '(damage|damaged|dent|bumper|bodywork|mirror|windshield|impact)')
       )
     )
   )
 WHERE deleted_at IS NULL;

UPDATE driverincidents i
   SET maintenance_id = m.maintenance_id
  FROM vehiclemaintenance m
 WHERE m.source_incident_id = i.incident_id
   AND i.maintenance_id IS NULL;

INSERT INTO vehiclemaintenance
  (vehicle_id, maintenance_date, maintenance_type, description, cost, status,
   priority, remarks, source_incident_id)
SELECT i.vehicle_id,
       CURRENT_DATE,
       CASE WHEN i.incident_type ~* '(accident|collision|crash)' THEN 'Vehicle Inspection' ELSE 'Emergency Repair' END,
       CASE WHEN i.incident_type ~* '(accident|collision|crash)'
         THEN 'Safety inspection generated from Incident #' || i.incident_id || ': ' || COALESCE(i.description, '')
         ELSE 'Emergency repair generated from Incident #' || i.incident_id || ': ' || COALESCE(i.description, '')
       END,
       0,
       'In Progress',
       'High',
       'Incident Type: ' || COALESCE(i.incident_type, 'Unknown') ||
         CASE WHEN i.expense_amount IS NOT NULL AND i.expense_amount > 0
           THEN ' | Driver-reported expense claim: PHP ' || to_char(i.expense_amount, 'FM999,999,990.00') || ' (unverified — confirm against actual invoice)'
           ELSE '' END ||
         CASE WHEN i.incident_type ~* '(accident|collision|crash)'
           THEN ' | Inspect for accident-related vehicle damage before release.' ELSE '' END,
       i.incident_id
  FROM driverincidents i
 WHERE i.deleted_at IS NULL
   AND i.status = 'Open'
   AND i.requires_vehicle_maintenance
   AND i.vehicle_id IS NOT NULL
   AND i.maintenance_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM vehiclemaintenance m
      WHERE m.source_incident_id = i.incident_id
   )
 ON CONFLICT DO NOTHING;

UPDATE driverincidents i
   SET maintenance_id = m.maintenance_id,
       maintenance_error = NULL
  FROM vehiclemaintenance m
 WHERE m.source_incident_id = i.incident_id
   AND i.maintenance_id IS NULL;

UPDATE vehicles v
   SET vehicle_status = 'Under Maintenance'
 WHERE v.deleted_at IS NULL
   AND v.vehicle_status <> 'Decommissioned'
   AND EXISTS (
     SELECT 1
       FROM driverincidents i
       JOIN vehiclemaintenance m ON m.source_incident_id = i.incident_id
      WHERE i.status = 'Open'
        AND i.vehicle_id = v.vehicle_id
        AND m.status IN ('Scheduled', 'In Progress')
        AND m.deleted_at IS NULL
   );

COMMIT;
