import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { syncVehicleStatus } from "@/services/status.service";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";
import { getIncidentPhotoUrls } from "@/lib/driver/incident-storage";
import {
  normalizeIncidentStatus,
  canTransition,
  resolutionActionsError,
  shouldKeepVehicleGrounded,
  INCIDENT_READ_ROLES,
  INCIDENT_ACTION_ROLES,
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
    await requireAuth(req, INCIDENT_READ_ROLES);

    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const { rows } = await query(
      `SELECT i.incident_id, i.driver_id, i.vehicle_id, i.trip_id, i.incident_type,
              i.incident_date, i.description, i.location, i.latitude, i.longitude,
              i.severity, i.status, i.actions_taken, i.created_at, i.updated_at,
              i.acknowledged_at, i.acknowledged_by, i.resolved_at, i.resolved_by,
              i.grounding_status, i.grounding_completed_at, i.grounding_error,
              i.requires_vehicle_maintenance, i.maintenance_id, i.maintenance_error,
              i.assistance_needed, i.expense_amount, i.photo_urls, v.plate_number,
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

    const photoUrls = await getIncidentPhotoUrls(rows[0].photo_urls, { driverId: rows[0].driver_id });
    return ok({
      ...rows[0],
      photo_urls: photoUrls,
      affected_dispatches: affectedDispatches,
      linked_maintenance: linkedMaintenance,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req, props) {
  try {
    const session = await requireAuth(req, INCIDENT_ACTION_ROLES);

    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
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

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT i.incident_id, i.status, i.actions_taken, i.vehicle_id,
                i.grounding_status, i.acknowledged_at, i.acknowledged_by,
                i.requires_vehicle_maintenance, i.maintenance_id,
                m.status AS maintenance_status,
                e.employee_id AS reporter_employee_id
           FROM driverincidents i
           LEFT JOIN drivers d ON d.driver_id = i.driver_id
           LEFT JOIN employees e ON e.employee_id = d.employee_id
           LEFT JOIN vehiclemaintenance m
             ON m.maintenance_id = i.maintenance_id AND m.deleted_at IS NULL
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [id]
      );
      const currentRow = current.rows[0];
      if (!currentRow) return { notFound: true };

      const transition = canTransition(normalizeIncidentStatus(currentRow.status), status);
      if (!transition.ok) return { conflict: true };
      if (status === "Resolved" && ["Pending", "Failed"].includes(currentRow.grounding_status)) {
        return { groundingConflict: true };
      }

      // A resolve without a documented narrative is not auditable.
      let finalActions = actionsTaken;
      if (status === "Resolved" && currentRow.status !== "Resolved") {
        const actionsError = resolutionActionsError(actionsTaken);
        if (actionsError) return { validationError: actionsError };
      }
      if (status === "Open") {
        finalActions = actionsTaken ?? currentRow.actions_taken ?? null;
      }

      const { rows } = await tx.query(
        `UPDATE driverincidents
            SET status = $1,
                actions_taken = $2,
                acknowledged_at = CASE
                  WHEN $1 = 'Resolved' THEN COALESCE(acknowledged_at, NOW())
                  WHEN $1 = 'Open' AND status = 'Resolved' THEN NULL
                  ELSE acknowledged_at
                END,
                acknowledged_by = CASE
                  WHEN $1 = 'Resolved' THEN COALESCE(acknowledged_by, $4)
                  WHEN $1 = 'Open' AND status = 'Resolved' THEN NULL
                  ELSE acknowledged_by
                END,
                resolved_at = CASE
                  WHEN $1 = 'Resolved' THEN COALESCE(resolved_at, NOW())
                  ELSE NULL
                END,
                resolved_by = CASE
                  WHEN $1 = 'Resolved' THEN COALESCE(resolved_by, $4)
                  ELSE NULL
                END,
                updated_at = NOW()
          WHERE incident_id = $3 AND deleted_at IS NULL
          RETURNING incident_id, status, actions_taken, acknowledged_at,
                    acknowledged_by, resolved_at, resolved_by`,
        [status, finalActions, id, session.user.employeeId ?? null]
      );

      // Resolving the incident is not maintenance completion. Keep a vehicle
      // grounded when its required work order is still open (or missing after
      // a failed automation attempt); only maintenance completion may release
      // it through syncVehicleStatus.
      const keepVehicleGrounded = shouldKeepVehicleGrounded({
        status,
        requiresVehicleMaintenance: currentRow.requires_vehicle_maintenance,
        maintenanceStatus: currentRow.maintenance_status,
      });
      if (keepVehicleGrounded && currentRow.vehicle_id) {
        await tx.query(
          `UPDATE vehicles
              SET vehicle_status = 'Under Maintenance', updated_at = NOW()
            WHERE vehicle_id = $1
              AND deleted_at IS NULL
              AND vehicle_status <> 'Decommissioned'`,
          [currentRow.vehicle_id]
        );
      }

      return { row: rows[0], current: currentRow, finalActions, keepVehicleGrounded };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.conflict) return err("This incident has already been resolved", 409);
    if (result.groundingConflict) return err("Complete or retry vehicle safety actions before resolving this incident", 409);
    if (result.validationError) return errValidation({ actions_taken: result.validationError });

    const vehicleId = result.current.vehicle_id;
    const reporterEmployeeId = result.current.reporter_employee_id;

    // Only a non-maintenance incident (or a completed work order) may restore
    // fleet availability. Maintenance-required incidents stay grounded until
    // the maintenance state machine completes; a sync hiccup is best-effort.
    if (vehicleId && status === "Resolved" && !result.keepVehicleGrounded) {
      try {
        await syncVehicleStatus(vehicleId);
      } catch (e) {
        console.warn("incident resolve vehicle sync failed:", e?.message || e);
      }
    }

    // Close the loop with the person who filed the report. Best-effort.
    if (reporterEmployeeId && result.current.status !== "Resolved") {
      try {
        const excerpt = result.finalActions ? String(result.finalActions).slice(0, 200) : "";
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

    await writeAudit(req, session, {
      action: "update",
      resource: "driverincidents",
      resourceId: id,
      oldValues: { status: result.current.status },
      newValues: {
        status: result.row.status,
        actions_taken: result.row.actions_taken,
        resolved_at: result.row.resolved_at,
        resolved_by: result.row.resolved_by,
      },
    });

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
