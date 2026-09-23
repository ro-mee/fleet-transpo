import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";
import { vehicleRepaired } from "@/lib/notifications/copy";

// Repeated rather than shared with the POST route: the two accept different
// required fields, and coupling them would make a PUT-only field silently
// writable on POST.
//
// The real column names are accepted alongside the API aliases because the
// maintenance page posts service_provider / service_center / remarks directly.
// deleted_at is PUT-only: archiveVehicleMaintenance in vehicle.service.js soft
// deletes by sending nothing else, so without it every archive would be
// rejected as "No writable fields were provided".
const FIELD_TO_COLUMN = {
  vehicle_id: "vehicle_id",
  maintenance_date: "maintenance_date",
  maintenance_type: "maintenance_type",
  description: "description",
  cost: "cost",
  status: "status",
  mileage_at_service: "mileage_at_service",
  next_service_date: "next_schedule_date",
  next_service_mileage: "next_schedule_mileage",
  technician_name: "service_provider",
  service_center_name: "service_center",
  priority: "priority",
  completed_date: "completed_date",
  notes: "remarks",
  next_schedule_date: "next_schedule_date",
  next_schedule_mileage: "next_schedule_mileage",
  service_provider: "service_provider",
  service_center: "service_center",
  remarks: "remarks",
  deleted_at: "deleted_at",
};

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "maintenance", "update");
    const id = (await params).id;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      vehicle_id: { type: "id", label: "Vehicle" },
      maintenance_date: { type: "date", label: "Maintenance date", validate: maintenanceDateRule },
      maintenance_type: { maxLength: 50, label: "Type" },
      description: { maxLength: 1000, label: "Description" },
      cost: { type: "positiveNumber", label: "Cost" },
      status: { maxLength: 30, label: "Status" },
      mileage_at_service: { type: "positiveNumber", label: "Mileage at service", max: MAX_ODOMETER_KM },
      next_service_date: { type: "date", label: "Next service date" },
      next_service_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
      technician_name: { maxLength: 255, label: "Technician name" },
      service_center_name: { maxLength: 255, label: "Service center" },
      priority: { maxLength: 30, label: "Priority" },
      completed_date: { type: "date", label: "Completed date", validate: completionDateRule },
      notes: { maxLength: 1000, label: "Notes" },
      next_schedule_date: { type: "date", label: "Next service date" },
      next_schedule_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
      service_provider: { maxLength: 255, label: "Technician name" },
      service_center: { maxLength: 255, label: "Service center" },
      remarks: { maxLength: 1000, label: "Notes" },
      deleted_at: { type: "date", label: "Archived at" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // Check prior state before allowing changes. This lookup uses its own
    // [id] param: passing the SET values array here would leave $1..$N-1
    // unreferenced and Postgres fails the parse with
    // "could not determine data type of parameter $1" (500 on every PUT).
    const beforeRow = (await query(
      `SELECT status, created_by, repair_completed_by FROM vehiclemaintenance WHERE maintenance_id = $1 AND deleted_at IS NULL`,
      [id]
    )).rows[0];

    if (!beforeRow) return err("Maintenance record not found", 404);

    const sets = [];
    const values = [];
    const seen = new Set();
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (body[field] === undefined) continue;
      if (seen.has(column)) continue;
      seen.add(column);
      values.push(body[field] === "" ? null : body[field]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return err("No writable fields were provided", 400);

    // An archived record is not editable. Without the deleted_at predicate
    // below, a PUT could amend a soft-deleted row and the recompute would
    // then push the vehicle's schedule from a record that is supposed
    // to be gone.
    
    const beforeStatus = beforeRow.status;
    const isTransitioningToCompleted = body.status === 'Completed' && beforeStatus !== 'Completed';
    const isTransitioningToPendingInspection = body.status === 'Pending Inspection' && beforeStatus !== 'Pending Inspection';

    if (beforeStatus === 'Completed' && body.status && body.status !== 'Completed') {
      return err("Completed maintenance records cannot be reopened.", 409);
    }
    
    if (isTransitioningToPendingInspection) {
      // The moment the repair is declared finished. Stamping the actor here is
      // what gives the completion guard below a real repairer to compare
      // against: created_by is the ticket's provenance, not the mechanic —
      // on an incident-sourced work order it names whoever resolved the
      // incident, which is why the old guard denied the admin its own queue.
      sets.push(`repair_completed_at = CURRENT_TIMESTAMP`);
      sets.push(`repair_completed_by = $${values.length + 1}`);
      values.push(session.user.employeeId);
    }

    if (isTransitioningToCompleted) {
      const { hasRole } = await import("@/lib/auth/permissions");
      if (!hasRole(session.user, ["super_admin", "admin", "fleet_manager"])) {
        return err("Only a Fleet Manager or Admin can approve maintenance completion.", 403);
      }

      // Separation of duties, keyed to whoever declared the repair finished.
      // Rows with no repairer on record — every record predating migration 113,
      // and any record that skipped 'Pending Inspection' — are not blocked: there
      // is no evidence of who did the work, and created_by is deliberately NOT a
      // fallback, because on an incident-sourced work order it names the staff
      // member who resolved the incident rather than the mechanic.
      if (
        beforeRow.repair_completed_by != null &&
        Number(beforeRow.repair_completed_by) === Number(session.user.employeeId)
      ) {
        return err("The person who completed this repair cannot approve its completion.", 403);
      }

      // Client-supplied approval fields cannot reach the SET list: FIELD_TO_COLUMN
      // is the allowlist and none of them appear in it. An earlier revision also
      // spliced them out of `sets` here, which would have desynchronised `values`
      // and shifted every later $n had it ever matched — unreachable, and a trap.
      sets.push(`manager_approved_by = $${values.length + 1}`);
      values.push(session.user.employeeId);
      
      sets.push(`manager_approved_at = CURRENT_TIMESTAMP`);
      
      sets.push(`completed_by = $${values.length + 1}`);
      values.push(session.user.employeeId);
      
      sets.push(`completed_at = CURRENT_TIMESTAMP`);
    }

    // The id goes last so every $n above lines up with values[n-1].
    values.push(id);
    const idParamIndex = values.length;

    const { rows } = await query(
      `UPDATE vehiclemaintenance SET ${sets.join(", ")}
        WHERE maintenance_id = $${idParamIndex} AND deleted_at IS NULL RETURNING *`,
      values
    );
    if (!rows[0]) return err("Maintenance record not found", 404);
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
      // Completing a record is what advances the vehicle's next due-dates.
      // Skipped when this request archived the record: a row on its way out
      // must not push a schedule forward, and the clamp would make that
      // push permanent.
      if (!rows[0].deleted_at) {
        await recomputeVehicleSchedule(rows[0].vehicle_id, rows[0]);
      }
    }
    // Close the loop on incident-sourced repairs (source_incident_id, migration
    // 063): when the work an incident triggered finishes, tell the driver who
    // reported it that the vehicle is back. Best-effort — never fails the PUT.
    if (
      rows[0]?.source_incident_id &&
      rows[0]?.status === "Completed" &&
      beforeStatus !== "Completed"
    ) {
      try {
        const { sendPush } = await import("@/services/push.service");
        const { rows: reporter } = await query(
          `SELECT e.employee_id
             FROM driverincidents i
             JOIN drivers d ON d.driver_id = i.driver_id
             JOIN employees e ON e.employee_id = d.employee_id
            WHERE i.incident_id = $1`,
          [rows[0].source_incident_id]
        );
        const reporterEmployeeId = reporter[0]?.employee_id;
        if (reporterEmployeeId) {
          const plate = (await query(
            `SELECT plate_number FROM vehicles WHERE vehicle_id = $1`,
            [rows[0].vehicle_id]
          )).rows[0]?.plate_number;
          const copy = vehicleRepaired({ plate: plate || null });
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reporterEmployeeId, copy.title, copy.message, "Info", "incident", rows[0].source_incident_id]
          );
          await sendPush({
            employeeIds: [reporterEmployeeId],
            title: copy.title,
            body: copy.pushBody,
            data: { reference_type: "incident", reference_id: rows[0].source_incident_id },
          });
        }
      } catch (e) {
        console.warn("maintenance completion notification failed:", e?.message || e);
      }
    }
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
