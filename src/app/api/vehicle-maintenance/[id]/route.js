import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";

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
  inspection_required: "inspection_required",
  inspection_completed_at: "inspection_completed_at",
  inspection_notes: "inspection_notes",
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
      inspection_required: { type: "boolean", label: "Inspection required" },
      inspection_completed_at: { type: "date", label: "Inspection completed at" },
      inspection_notes: { maxLength: 1000, label: "Inspection notes" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

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

    // An archived record is not editable. Without this predicate a PUT could
    // amend a soft-deleted row and the recompute below would then push the
    // vehicle's schedule from a record that is supposed to be gone.
    values.push(id);
    const idParamIndex = values.length;
    
    // Check prior state before allowing changes
    const beforeRow = (await query(
      `SELECT status, created_by, inspection_required, inspection_completed_at, inspected_by FROM vehiclemaintenance WHERE maintenance_id = $${idParamIndex} AND deleted_at IS NULL`,
      values
    )).rows[0];
    
    if (!beforeRow) return err("Maintenance record not found", 404);
    
    const beforeStatus = beforeRow.status;
    const isTransitioningToCompleted = body.status === 'Completed' && beforeStatus !== 'Completed';
    const isTransitioningToPendingInspection = body.status === 'Pending Inspection' && beforeStatus !== 'Pending Inspection';

    if (beforeStatus === 'Completed' && body.status && body.status !== 'Completed') {
      return err("Completed maintenance records cannot be reopened.", 409);
    }
    
    if (isTransitioningToPendingInspection) {
      sets.push(`repair_completed_at = CURRENT_TIMESTAMP`);
    }

    if (isTransitioningToCompleted) {
      const { hasRole } = await import("@/lib/auth/permissions");
      if (!hasRole(session.user, ["system_admin", "admin", "fleet_manager"])) {
        return err("Only a Fleet Manager or Admin can approve maintenance completion.", 403);
      }

      if (beforeRow.created_by === session.user.employeeId) {
        return err("Mechanics cannot approve their own repairs. Manager inspection required.", 403);
      }
      
      const requiresInspection = body.inspection_required !== undefined ? body.inspection_required : beforeRow.inspection_required;
      if (requiresInspection) {
        if (!body.inspection_completed_at && !beforeRow.inspection_completed_at) {
          return err("Inspection must be completed before marking as Completed", 400);
        }
        if (body.inspection_completed_at && !beforeRow.inspection_completed_at) {
          sets.push(`inspected_by = $${values.length + 1}`);
          values.push(session.user.employeeId);
        }
      }

      // Remove any client-supplied approval fields
      const approvalFields = ["manager_approved_by", "manager_approved_at", "completed_by", "completed_at"];
      for (let i = sets.length - 1; i >= 0; i--) {
        if (approvalFields.some(f => sets[i].startsWith(f))) {
          sets.splice(i, 1);
        }
      }

      sets.push(`manager_approved_by = $${values.length + 1}`);
      values.push(session.user.employeeId);
      
      sets.push(`manager_approved_at = CURRENT_TIMESTAMP`);
      
      sets.push(`completed_by = $${values.length + 1}`);
      values.push(session.user.employeeId);
      
      sets.push(`completed_at = CURRENT_TIMESTAMP`);
    }

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
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reporterEmployeeId, "Vehicle Repair Completed",
             `The vehicle from your incident report (#${rows[0].source_incident_id}) has been repaired${plate ? ` (${plate})` : ""} and is back in service.`,
             "Info", "incident", rows[0].source_incident_id]
          );
          await sendPush({
            employeeIds: [reporterEmployeeId],
            title: "Vehicle Repair Completed",
            body: `The vehicle from your incident report (#${rows[0].source_incident_id}) is back in service.`,
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
