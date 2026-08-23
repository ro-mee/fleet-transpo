import { query, withTransaction } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus } from "@/services/status.service";
import { sendPush } from "@/services/push.service";
import {
  buildEmergencyMaintenancePayload,
  MAINTENANCE_ACTIONS_TAKEN,
} from "@/lib/incidents/resolution";

/**
 * POST /api/incidents/[id]/maintenance
 *
 * Route an open incident's vehicle to emergency repairs and resolve the
 * incident in one atomic request.
 *
 * This replaces a client-side two-call sequence (create the maintenance
 * record, then PATCH the incident) that could strand an In Progress repair
 * record against a still-open incident — or, on a retry after that failure,
 * create duplicate emergency repairs. Both writes now share one transaction,
 * and the resolved guard below makes a replay an explicit 409 instead of a
 * second repair row.
 */
export async function POST(req, props) {
  try {
    const session = await requireAuth(req, [
      "system_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
    ]);

    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const result = await withTransaction(async (tx) => {
      // Lock the row so two concurrent clicks cannot both pass the guard.
      const current = await tx.query(
        `SELECT i.incident_id, i.vehicle_id, i.status, i.description,
                i.expense_amount, i.incident_type, e.employee_id AS reporter_employee_id
           FROM driverincidents i
           LEFT JOIN drivers d ON d.driver_id = i.driver_id
           LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [id]
      );
      const incident = current.rows[0];
      if (!incident) return { notFound: true };

      if (incident.status === "Resolved") return { conflict: true };
      if (!incident.vehicle_id) {
        return { noVehicle: true };
      }

      const payload = buildEmergencyMaintenancePayload(incident);

      const maintenanceResult = await tx.query(
        `INSERT INTO vehiclemaintenance
           (vehicle_id, maintenance_date, maintenance_type, description,
            cost, status, priority, remarks, created_by, source_incident_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING maintenance_id, vehicle_id, maintenance_type, maintenance_date,
                   status, priority, cost`,
        [
          incident.vehicle_id,
          payload.maintenance_date,
          payload.maintenance_type,
          payload.description,
          payload.cost,
          payload.status,
          payload.priority,
          payload.remarks,
          session.user.employeeId ?? null,
          incident.incident_id,
        ]
      );

      const incidentResult = await tx.query(
        `UPDATE driverincidents
            SET status = 'Resolved',
                actions_taken = $2,
                updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING incident_id, status, actions_taken`,
        [id, MAINTENANCE_ACTIONS_TAKEN]
      );

      return { incident: incidentResult.rows[0], maintenance: maintenanceResult.rows[0] };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.conflict) return err("This incident has already been resolved", 409);
    if (result.noVehicle) {
      return err("This incident has no vehicle attached, so there is nothing to send to maintenance", 400);
    }

    // Best-effort follow-ups: the resolution itself is committed; these must
    // never turn it into an error after the fact.
    try {
      await syncVehicleStatus(result.maintenance.vehicle_id);
    } catch (e) {
      console.warn("incident maintenance vehicle sync failed:", e?.message || e);
    }

    try {
      const reporter = await query(
        `SELECT e.employee_id
           FROM driverincidents i
           JOIN drivers d ON d.driver_id = i.driver_id
           JOIN employees e ON e.employee_id = d.employee_id
          WHERE i.incident_id = $1`,
        [id]
      );
      const reporterEmployeeId = reporter.rows[0]?.employee_id;
      if (reporterEmployeeId) {
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [reporterEmployeeId, "Incident Report Resolved",
           `Your incident report (#${id}) was routed to the maintenance team for emergency repairs.`,
           "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [reporterEmployeeId],
          title: "Incident Report Resolved",
          body: `Your incident report (#${id}) was routed to the maintenance team for emergency repairs.`,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      }
    } catch (e) {
      console.warn("incident maintenance notification failed:", e?.message || e);
    }

    return ok(result, 201);
  } catch (e) {
    return handleError(e);
  }
}
