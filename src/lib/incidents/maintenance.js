import { query, withTransaction } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { buildIncidentMaintenancePayload } from "@/lib/incidents/resolution";
import { requiresVehicleMaintenance } from "@/lib/driver/grounding";

const MAINTENANCE_ROLES = ["system_admin", "admin", "fleet_manager"];

/**
 * Create or recover the single work order belonging to an incident. The
 * incident row lock and unique source_incident_id index make retries safe.
 */
export async function ensureIncidentMaintenance({ incidentId, session }) {
  return withTransaction(async (tx) => {
    const { rows: incidentRows } = await tx.query(
      `SELECT incident_id, vehicle_id, incident_type, severity, description,
              expense_amount, grounding_status, requires_vehicle_maintenance, maintenance_id
         FROM driverincidents
        WHERE incident_id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [incidentId]
    );
    const incident = incidentRows[0];
    if (!incident) return { notFound: true };

    const required = incident.requires_vehicle_maintenance || requiresVehicleMaintenance(incident);
    if (!incident.vehicle_id) return { noVehicle: true, incident };
    if (!required) return { notRequired: true, incident };

    const { rows: existingRows } = await tx.query(
      `SELECT maintenance_id, vehicle_id, maintenance_type, maintenance_date,
              status, priority, cost, source_incident_id
         FROM vehiclemaintenance
        WHERE source_incident_id = $1
        ORDER BY maintenance_id DESC
        LIMIT 1`,
      [incident.incident_id]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (incident.maintenance_id !== existing.maintenance_id || !incident.requires_vehicle_maintenance) {
        await tx.query(
          `UPDATE driverincidents
              SET maintenance_id = $2,
                  requires_vehicle_maintenance = TRUE,
                  maintenance_error = NULL,
                  updated_at = NOW()
            WHERE incident_id = $1 AND deleted_at IS NULL`,
          [incident.incident_id, existing.maintenance_id]
        );
      }
      return { workOrder: existing, created: false, incident };
    }

    const payload = buildIncidentMaintenancePayload(incident);
    const { rows: insertedRows } = await tx.query(
      `INSERT INTO vehiclemaintenance
         (vehicle_id, maintenance_date, maintenance_type, description,
          cost, status, priority, remarks, created_by, source_incident_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING maintenance_id, vehicle_id, maintenance_type, maintenance_date,
                 status, priority, cost, source_incident_id`,
      [
        incident.vehicle_id,
        payload.maintenance_date,
        payload.maintenance_type,
        payload.description,
        payload.cost,
        payload.status,
        payload.priority,
        payload.remarks,
        session?.user?.employeeId ?? null,
        incident.incident_id,
      ]
    );
    const workOrder = insertedRows[0];
    if (!workOrder) {
      const { rows: recoveredRows } = await tx.query(
        `SELECT maintenance_id, vehicle_id, maintenance_type, maintenance_date,
                status, priority, cost, source_incident_id
           FROM vehiclemaintenance
          WHERE source_incident_id = $1
          ORDER BY maintenance_id DESC
          LIMIT 1`,
        [incident.incident_id]
      );
      if (!recoveredRows[0]) throw new Error("Maintenance work order could not be created");
      return { workOrder: recoveredRows[0], created: false, incident };
    }

    await tx.query(
      `UPDATE driverincidents
          SET maintenance_id = $2,
              requires_vehicle_maintenance = TRUE,
              maintenance_error = NULL,
              updated_at = NOW()
        WHERE incident_id = $1 AND deleted_at IS NULL`,
      [incident.incident_id, workOrder.maintenance_id]
    );
    return { workOrder, created: true, incident };
  });
}

/** Notify only the roles that own the maintenance queue. Failure is best-effort. */
export async function notifyMaintenanceTeam(workOrder, incidentId) {
  if (!workOrder?.maintenance_id) return;
  const { rows: recipients } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
    [MAINTENANCE_ROLES]
  );
  if (!recipients.length) return;

  const title = "Incident Maintenance Work Order Created";
  const message = `Maintenance work order #${workOrder.maintenance_id} was created for Incident #${incidentId}.`;
  const inserted = [];
  for (const recipient of recipients) {
    const { rows } = await query(
      `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE employee_id = $1 AND title = $2
             AND reference_type = $5 AND reference_id = $6
        )
       RETURNING employee_id`,
      [recipient.employee_id, title, message, "Alert", "maintenance", workOrder.maintenance_id]
    );
    if (rows[0]) inserted.push(recipient.employee_id);
  }
  if (inserted.length) {
    await sendPush({
      employeeIds: inserted,
      title,
      body: message,
      data: { reference_type: "maintenance", reference_id: workOrder.maintenance_id },
    });
  }
}
