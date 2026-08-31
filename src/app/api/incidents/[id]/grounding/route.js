import { query, withTransaction } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { groundIncident } from "@/lib/incidents/grounding";
import { INCIDENT_ACTION_ROLES } from "@/lib/incidents/resolution";

/** Retry the safety side effects for a report whose first grounding attempt failed. */
export async function POST(req, props) {
  try {
    const session = await requireAuth(req, INCIDENT_ACTION_ROLES);
    const { id } = await props.params;
    if (!id) return err("Incident ID is required", 400);

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT incident_id, driver_id, vehicle_id, incident_type, severity,
                status, grounding_status
           FROM driverincidents
          WHERE incident_id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [id]
      );
      const incident = rows[0];
      if (!incident) return { notFound: true };
      if (!incident.vehicle_id) return { noVehicle: true };
      if (incident.grounding_status === "Not Required") return { notRequired: true };
      if (incident.grounding_status === "Pending") return { pending: true };
      if (incident.grounding_status === "Complete") return { complete: incident };

      const { rows: updated } = await tx.query(
        `UPDATE driverincidents
            SET grounding_status = 'Pending', grounding_error = NULL, updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING incident_id, driver_id, vehicle_id, incident_type, severity,
                    status, grounding_status`,
        [id]
      );
      return { incident: updated[0] };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.noVehicle) return err("This incident has no vehicle to ground", 400);
    if (result.notRequired) return err("This incident does not require vehicle grounding", 400);
    if (result.pending) return err("Vehicle safety actions are already in progress", 409);
    if (result.complete) return ok(result.complete);

    const incident = result.incident;

    try {
      await groundIncident({ incident, session, req });
    } catch (cause) {
      const message = String(cause?.message || cause).slice(0, 1000);
      await query(
        `UPDATE driverincidents
            SET grounding_status = 'Failed', grounding_error = $2, updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL`,
        [id, message]
      ).catch(() => {});
      await writeAudit(req, session, {
        action: "ground_retry_failed",
        resource: "driverincidents",
        resourceId: id,
        newValues: { grounding_status: "Failed", grounding_error: message },
      });
      return err("Vehicle safety actions could not be completed. Try again or contact an administrator.", 502);
    }

    const { rows: updated } = await query(
      `SELECT incident_id, vehicle_id, status, grounding_status, grounding_completed_at, grounding_error
         FROM driverincidents
        WHERE incident_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return ok(updated[0] || { incident_id: Number(id), grounding_status: "Complete" });
  } catch (e) {
    return handleError(e);
  }
}
