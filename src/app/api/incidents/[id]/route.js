import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { syncVehicleStatus } from "@/services/status.service";
import { sendPush } from "@/services/push.service";
import {
  normalizeIncidentStatus,
  canTransition,
  resolutionActionsError,
} from "@/lib/incidents/resolution";

// Staff resolution endpoints. Resolving is no longer just a row edit: it also
// restores the vehicle's availability (grounding automation set it to
// "Under Maintenance" at report time) and tells the reporting driver what was
// done — previously the loop closed nowhere and the driver never learned the
// outcome.

/**
 * GET /api/incidents/[id]
 *
 * Resolver context: the incident plus everything the grounding automation did
 * on its behalf — the dispatches it tore down to Pending Reassignment (matched
 * by the exact audit reason the automation writes) and any emergency repairs
 * linked to it. Without this, whoever resolves cannot verify reassignment
 * happened or see the repair state.
 */
export async function GET(req, props) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);

    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const { rows } = await query(
      `SELECT i.incident_id, i.driver_id, i.vehicle_id, i.trip_id, i.incident_type,
              i.incident_date, i.description, i.location, i.latitude, i.longitude,
              i.severity, i.status, i.actions_taken, i.created_at, i.updated_at,
              i.assistance_needed, i.expense_amount, v.plate_number,
              CASE WHEN d.driver_id IS NULL THEN NULL ELSE
                json_build_object('driver_id', d.driver_id, 'first_name', e.first_name, 'last_name', e.last_name)
              END AS driver
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
         LEFT JOIN drivers d ON d.driver_id = i.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
        WHERE i.incident_id = $1 AND i.deleted_at IS NULL`,
      [id]
    );
    if (!rows[0]) return err("Incident not found", 404);

    // Grounding writes one audit entry per interrupted dispatch with this exact
    // reason string (src/app/api/driver/incidents/route.js).
    const { rows: affectedDispatches } = await query(
      `SELECT DISTINCT ON (a.resource_id)
              a.resource_id AS dispatch_id,
              ds.dispatch_number, ds.status AS dispatch_status,
              r.guest_name, ds.scheduled_departure,
              a.created_at AS interrupted_at
         FROM audit_logs a
         JOIN dispatchschedules ds ON ds.dispatch_id = a.resource_id AND ds.deleted_at IS NULL
         LEFT JOIN transportation_requests r ON r.request_id = ds.request_id
        WHERE a.resource = 'dispatchschedules'
          AND a.old_values->>'reason' = $1
        ORDER BY a.resource_id, a.created_at DESC`,
      [`Incident #${id} grounded the vehicle.`]
    );

    const { rows: linkedMaintenance } = await query(
      `SELECT maintenance_id, vehicle_id, maintenance_type, maintenance_date,
              completed_date, status, priority, cost
         FROM vehiclemaintenance
        WHERE source_incident_id = $1 AND deleted_at IS NULL
        ORDER BY maintenance_date DESC`,
      [id]
    );

    return ok({
      ...rows[0],
      affected_dispatches: affectedDispatches,
      linked_maintenance: linkedMaintenance,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req, props) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);

    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const body = await parseBody(req);
    const errors = validateBody(body, {
      status: { required: true, maxLength: 50, label: "Status" },
      actions_taken: { maxLength: 2000, label: "Actions Taken" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const status = normalizeIncidentStatus(body.status);
    if (!status) {
      return errValidation({ status: `Status must be one of: Open, Resolved` });
    }

    const actionsTaken =
      body.actions_taken !== undefined && body.actions_taken !== null
        ? String(body.actions_taken)
        : null;

    const current = await query(
      `SELECT i.status, i.actions_taken, i.vehicle_id,
              e.employee_id AS reporter_employee_id
         FROM driverincidents i
         LEFT JOIN drivers d ON d.driver_id = i.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
        WHERE i.incident_id = $1 AND i.deleted_at IS NULL`,
      [id]
    );
    if (!current.rows[0]) return err("Incident not found", 404);

    const transition = canTransition(current.rows[0].status, status);
    if (!transition.ok) {
      return err("This incident has already been resolved", 409);
    }

    // A resolve without a documented narrative is not auditable.
    let finalActions = actionsTaken;
    if (status === "Resolved" && current.rows[0].status !== "Resolved") {
      const actionsError = resolutionActionsError(actionsTaken);
      if (actionsError) return errValidation({ actions_taken: actionsError });
    }
    if (status === "Open") {
      // Reopening keeps the previous record for the audit trail unless an
      // explicit replacement is supplied.
      finalActions = actionsTaken ?? current.rows[0].actions_taken ?? null;
    }

    const { rows } = await query(
      `UPDATE driverincidents
          SET status = $1,
              actions_taken = $2,
              updated_at = NOW()
        WHERE incident_id = $3 AND deleted_at IS NULL
        RETURNING incident_id, status, actions_taken`,
      [status, finalActions, id]
    );

    if (rows.length === 0) return err("Incident not found", 404);

    const vehicleId = current.rows[0].vehicle_id;
    const reporterEmployeeId = current.rows[0].reporter_employee_id;

    // Restore fleet availability. The report may have grounded the vehicle; if
    // no active maintenance record keeps it out of service, this returns it to
    // Available. Best-effort: a sync hiccup must not fail a completed resolve.
    if (vehicleId && status === "Resolved") {
      try {
        await syncVehicleStatus(vehicleId);
      } catch (e) {
        console.warn("incident resolve vehicle sync failed:", e?.message || e);
      }
    }

    // Close the loop with the person who filed the report. Best-effort.
    if (reporterEmployeeId && current.rows[0].status !== "Resolved") {
      try {
        const excerpt = finalActions ? String(finalActions).slice(0, 200) : "";
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [reporterEmployeeId, "Incident Report Resolved",
           `Your incident report (#${id}) was resolved by the fleet team.${excerpt ? ` Actions taken: ${excerpt}` : ""}`,
           "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [reporterEmployeeId],
          title: "Incident Report Resolved",
          body: `Your incident report (#${id}) was resolved by the fleet team.`,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("incident resolve notification failed:", e?.message || e);
      }
    }

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
