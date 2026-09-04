import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseOptionalBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";
import { syncVehicleStatus } from "@/services/status.service";
import { resolveFromField } from "@/lib/incidents/field-resolution";
import { fieldResolutionGuardMessage } from "@/lib/incidents/resolution";

const OVERSEER_ROLES = ["system_admin", "fleet_manager", "admin"];

/**
 * POST /api/driver/responder/resolve
 *
 * Field resolution by the assigned fleet responder — the mirror of the
 * reporter endpoint. Once help is on scene (response_status 'Arrived'), the
 * responder can close the incident themselves: the overseers are paged and
 * the stranded driver is asked to confirm or dispute, exactly as after a
 * staff resolve (their confirmation state is untouched here). No incident id
 * in the path — like /api/driver/responder/arrived, the caller's active
 * assignment identifies the mission.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driverId = session.user.driverId;
    const employeeId = session.user.employeeId ?? null;

    // The mobile app posts this with no body when the responder has no note
    // to add — an empty request is valid (parseOptionalBody), only malformed
    // JSON is a 400.
    const body = await parseOptionalBody(req);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 2000) {
      return errValidation({ note: "Resolution notes must be 2000 characters or fewer" });
    }

    // Find the caller's active mission (one responder, one active assignment
    // by design — same semantics as the arrived endpoint).
    const { rows: missions } = await query(
      `SELECT incident_id
         FROM driverincidents
        WHERE responder_driver_id = $1
          AND status = 'Open'
          AND deleted_at IS NULL
        ORDER BY responder_assigned_at DESC NULLS LAST
        LIMIT 1`,
      [driverId]
    );
    const mission = missions[0];
    if (!mission) return err("No open responder assignment for this driver", 404);

    const nameRow = employeeId
      ? await query(`SELECT first_name, last_name FROM employees WHERE employee_id = $1`, [employeeId])
      : null;
    const responderName = nameRow?.rows[0]
      ? `${nameRow.rows[0].first_name || ""} ${nameRow.rows[0].last_name || ""}`.trim()
      : "A fleet responder";

    const result = await withTransaction((tx) =>
      resolveFromField(tx, {
        incidentId: mission.incident_id,
        confirmer: { employeeId, role: "responder", name: responderName },
        note,
        assertResponderDriverId: driverId,
      })
    );

    if (result.guard) {
      const status = result.guard === "not-found" ? 404 : 409;
      return err(fieldResolutionGuardMessage(result.guard), status);
    }
    const incidentId = result.row.incident_id;

    // Only a non-maintenance incident (or one whose work order completed) may
    // restore fleet availability — same rule as the staff resolve, best-effort.
    if (result.current.vehicle_id && !result.keepVehicleGrounded) {
      try {
        await syncVehicleStatus(result.current.vehicle_id);
      } catch (e) {
        console.warn("field resolve vehicle sync failed:", e?.message || e);
      }
    }

    // Page the overseers: the rescue closed in the field, before staff could
    // click resolve. Best-effort.
    try {
      const { rows: overseers } = await query(
        `SELECT e.employee_id
           FROM employees e
           JOIN roles r ON r.role_id = e.role_id
          WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
        [OVERSEER_ROLES]
      );
      const message =
        `${responderName} (responder) resolved incident #${incidentId} from the mobile app` +
        `${note ? `: ${note.slice(0, 200)}` : "."} The driver can confirm or dispute from their app.`;
      for (const employee of overseers) {
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [employee.employee_id, "Incident Resolved by Responder", message, "Info", "incident", incidentId]
        );
      }
      if (overseers.length) {
        await sendPush({
          employeeIds: overseers.map((employee) => employee.employee_id),
          title: "Incident Resolved by Responder",
          body: message,
          data: { reference_type: "incident", reference_id: Number(incidentId) },
        });
      }
    } catch (e) {
      console.warn("field resolve overseer notification failed:", e?.message || e);
    }

    // The stranded driver gets the same soft-close prompt a staff resolve
    // gives them: confirm they are safe, or dispute with a reason.
    if (result.current.reporter_employee_id) {
      try {
        const message =
          `Your incident report (#${incidentId}) was resolved by ${responderName} from their phone.` +
          `${note ? ` Note: ${note.slice(0, 200)}` : ""} Please confirm you are safe, or tell us if you still need help.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.current.reporter_employee_id, "Incident Report Resolved", message, "Info", "incident", incidentId]
        );
        await sendPush({
          employeeIds: [result.current.reporter_employee_id],
          title: "Incident Report Resolved",
          body: `Your incident report (#${incidentId}) was resolved by ${responderName}. Please confirm or dispute.`,
          data: { reference_type: "incident", reference_id: Number(incidentId) },
        });
      } catch (e) {
        console.warn("field resolve driver notification failed:", e?.message || e);
      }
    }

    await writeAudit(req, session, {
      action: "responder_field_resolve",
      resource: "driverincidents",
      resourceId: String(incidentId),
      oldValues: { status: result.current.status },
      newValues: {
        status: result.row.status,
        resolved_at: result.row.resolved_at,
        resolved_by: result.row.resolved_by,
        actions_taken: result.row.actions_taken,
      },
    });

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
