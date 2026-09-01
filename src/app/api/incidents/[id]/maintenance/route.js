import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { groundIncident } from "@/lib/incidents/grounding";
import { ensureIncidentMaintenance, notifyMaintenanceTeam } from "@/lib/incidents/maintenance";
import { writeAudit } from "@/lib/audit";

/**
 * Ensure the rule-based maintenance work order for an incident exists.
 *
 * This remains as a safe recovery endpoint for older reports or a failed
 * automatic attempt. It never resolves the incident; maintenance completion
 * is the separate event that can release the vehicle.
 */
export async function POST(req, props) {
  try {
    const session = await requirePermission(req, "incidents", "route_to_maintenance");
    const { id } = await props.params;
    if (!id) return err("Incident ID is required", 400);

    const result = await ensureIncidentMaintenance({ incidentId: id, session });
    if (result.notFound) return err("Incident not found", 404);
    if (result.noVehicle) return err("This incident has no vehicle attached", 400);
    if (result.notRequired) return err("This incident does not require vehicle maintenance", 400);

    let groundingError = null;
    if (result.incident?.vehicle_id && result.incident.grounding_status !== "Complete") {
      try {
        await groundIncident({
          incident: {
            ...result.incident,
            grounding_status: "Pending",
          },
          session,
          req,
        });
      } catch (cause) {
        const message = String(cause?.message || cause).slice(0, 1000);
        groundingError = message;
        await query(
          `UPDATE driverincidents
              SET grounding_status = 'Failed', grounding_error = $2, updated_at = NOW()
            WHERE incident_id = $1 AND deleted_at IS NULL`,
          [id, message]
        ).catch(() => {});
      }
    }

    if (result.created) {
      await writeAudit(req, session, {
        action: "auto_create",
        resource: "vehiclemaintenance",
        resourceId: result.workOrder.maintenance_id,
        newValues: {
          source_incident_id: id,
          maintenance_type: result.workOrder.maintenance_type,
          status: result.workOrder.status,
        },
      });
    }
    try {
      // Notification writes are deduplicated, so a recovery can safely retry
      // a delivery that failed after the work order was created.
      await notifyMaintenanceTeam(result.workOrder, id);
    } catch (e) {
      console.warn("incident maintenance notification failed:", e?.message || e);
    }

    if (groundingError) return err("Maintenance work order exists, but vehicle safety actions need a retry", 502);

    return ok({ ...result.workOrder, incident_id: Number(id) }, result.created ? 201 : 200);
  } catch (e) {
    return handleError(e);
  }
}
