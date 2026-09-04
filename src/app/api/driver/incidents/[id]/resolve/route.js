import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseOptionalBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";
import { syncVehicleStatus } from "@/services/status.service";
import { resolveFromField } from "@/lib/incidents/field-resolution";
import { fieldResolutionGuardMessage } from "@/lib/incidents/resolution";

const OVERSEER_ROLES = ["system_admin", "fleet_manager", "admin"];

/**
 * POST /api/driver/incidents/[id]/resolve
 *
 * Field resolution by the reporting driver: they are the one who knows
 * whether the situation is actually handled (help arrived and fixed it, or it
 * was a false alarm they sorted themselves). Their confirmation resolves the
 * incident immediately — resolution *is* their confirmation of it — pages the
 * overseers who manage incident reports, and tells the assigned responder
 * their mission is complete. Guards mirror the staff resolve (see
 * fieldResolutionGuards).
 */
export async function POST(req, props) {
  try {
    const session = await requireDriver(req);
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    // The mobile app posts this with no body when the driver has no note to
    // add — an empty request is valid (parseOptionalBody), only malformed
    // JSON is a 400.
    const body = await parseOptionalBody(req);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 2000) {
      return errValidation({ note: "Resolution notes must be 2000 characters or fewer" });
    }

    const employeeId = session.user.employeeId ?? null;
    const nameRow = employeeId
      ? await query(`SELECT first_name, last_name FROM employees WHERE employee_id = $1`, [employeeId])
      : null;
    const confirmerName = nameRow?.rows[0]
      ? `${nameRow.rows[0].first_name || ""} ${nameRow.rows[0].last_name || ""}`.trim()
      : "the reporting driver";

    const result = await withTransaction((tx) =>
      resolveFromField(tx, {
        incidentId: id,
        confirmer: { employeeId, role: "driver", name: confirmerName },
        note,
        assertDriverId: session.user.driverId,
      })
    );

    if (result.guard) {
      const status = result.guard === "not-found" ? 404 : 409;
      return err(fieldResolutionGuardMessage(result.guard), status);
    }

    // Only a non-maintenance incident (or one whose work order completed) may
    // restore fleet availability — same rule as the staff resolve, best-effort.
    if (result.current.vehicle_id && !result.keepVehicleGrounded) {
      try {
        await syncVehicleStatus(result.current.vehicle_id);
      } catch (e) {
        console.warn("field resolve vehicle sync failed:", e?.message || e);
      }
    }

    // Page the overseers: a field-closed incident is exactly what the people
    // managing incident reports need to know about. Best-effort.
    try {
      const { rows: overseers } = await query(
        `SELECT e.employee_id
           FROM employees e
           JOIN roles r ON r.role_id = e.role_id
          WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
        [OVERSEER_ROLES]
      );
      const message =
        `${confirmerName} (driver) resolved incident #${id} from the mobile app` +
        `${note ? `: ${note.slice(0, 200)}` : "."} The driver confirmed the outcome themselves.`;
      for (const employee of overseers) {
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [employee.employee_id, "Incident Resolved by Driver", message, "Info", "incident", id]
        );
      }
      if (overseers.length) {
        await sendPush({
          employeeIds: overseers.map((employee) => employee.employee_id),
          title: "Incident Resolved by Driver",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      }
    } catch (e) {
      console.warn("field resolve overseer notification failed:", e?.message || e);
    }

    // Close the loop with the assigned responder, if any — their mission ends
    // here even though the incident left their feed the moment it resolved.
    if (result.current.responder_employee_id) {
      try {
        const message = `The driver confirmed incident #${id} is resolved — your rescue mission is complete. Thank you.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.current.responder_employee_id, "Mission Complete", message, "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [result.current.responder_employee_id],
          title: "Mission Complete",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("field resolve responder notification failed:", e?.message || e);
      }
    }

    await writeAudit(req, session, {
      action: "driver_field_resolve",
      resource: "driverincidents",
      resourceId: id,
      oldValues: { status: result.current.status },
      newValues: {
        status: result.row.status,
        resolved_at: result.row.resolved_at,
        resolved_by: result.row.resolved_by,
        actions_taken: result.row.actions_taken,
        driver_confirmed_at: result.row.driver_confirmed_at,
      },
    });

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
