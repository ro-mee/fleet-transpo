import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { vehicleRepaired } from "@/lib/notifications/copy";
import { writeAuditRequired } from "@/lib/audit";

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
  // Task-1 work-order columns. assigned_at / repair_started_at are
  // server-stamped only and deliberately absent here so a client value can
  // never reach the SET list; assigned_mechanic_id is staff-writable.
  assigned_mechanic_id: "assigned_mechanic_id",
  rejection_reason: "rejection_reason",
  diagnosis: "diagnosis",
  parts_replaced: "parts_replaced",
  labor_hours: "labor_hours",
};

// Per-role state machines for the PUT guards below.
// - Mechanics move work forward only: Scheduled → In Progress → Pending Inspection.
// - Staff (fleet_manager/admin/super_admin) retain the direct Scheduled →
//   Completed edge for externally-completed work (ruling C2, 2026-10-06). A
//   direct staff completion leaves repair_completed_by NULL and is therefore
//   intentionally outside the four-eyes gate — same as every pre-113 row.
// - Completed and Cancelled are terminal (rulings C1/C3, 2026-10-06): the
//   empty edge lists backstop the full-row freeze, which owns the refusal.
const MECHANIC_TRANSITIONS = { "Scheduled": ["In Progress"], "In Progress": ["Pending Inspection"] };
const STAFF_TRANSITIONS = {
  "Scheduled": ["In Progress", "Cancelled", "Completed"],
  "In Progress": ["Pending Inspection", "Completed"],
  "Pending Inspection": ["Completed", "In Progress"],
  "Completed": [],
  "Cancelled": [],
};
// Mechanic field whitelist (raw API field names, applied to the body BEFORE the
// FIELD_TO_COLUMN mapping). Everything else — cost, vehicle_id, priority,
// deleted_at, next_schedule_*, assigned_mechanic_id, assigned_at — is stripped.
const MECHANIC_WRITABLE = new Set(["status", "description", "remarks", "mileage_at_service",
  "service_provider", "service_center", "technician_name", "service_center_name", "notes",
  "diagnosis", "parts_replaced", "labor_hours"]);

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
      assigned_mechanic_id: { type: "id", label: "Assigned mechanic" },
      rejection_reason: { maxLength: 1000, label: "Rejection reason" },
      // Task 6 contract: parts_replaced must be a JSON array, diagnosis ≤ 2000 chars.
      diagnosis: { maxLength: 2000, label: "Diagnosis" },
      parts_replaced: { label: "Parts replaced", validate: (v) => (v == null || Array.isArray(v) ? null : "Parts replaced must be a list.") },
      labor_hours: { type: "positiveNumber", label: "Labor hours" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const updateResult = await withTransaction(async (tx) => {
      // Lock the active row so concurrent reviews cannot both pass the state
      // guards and commit conflicting maintenance transitions.
      const beforeRow = (await tx.query(
        `SELECT status, created_by, repair_completed_by, assigned_mechanic_id, repair_started_at FROM vehiclemaintenance WHERE maintenance_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      )).rows[0];
      if (!beforeRow) return { error: err("Maintenance record not found", 404) };

      const isMechanic = normalizeRoleName(session.user.role) === "mechanic";

      // Rule 1 — ownership: a mechanic may touch only rows assigned to them.
      // assigned_mechanic_id NULL (unassigned) never equals an employee id.
      if (isMechanic && Number(beforeRow.assigned_mechanic_id) !== Number(session.user.employeeId)) {
        return { error: err("You are not assigned to this maintenance record.", 403) };
      }

      // Rule 2 — mechanic field whitelist, plus server-stamped columns that are
      // never client-writable for any role (assigned_at is stamped below).
      delete body.assigned_at;
      if (isMechanic) {
        for (const key of Object.keys(body)) {
          if (!MECHANIC_WRITABLE.has(key)) delete body[key];
        }
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
      if (sets.length === 0) return { error: err("No writable fields were provided", 400) };

      const beforeStatus = beforeRow.status;
      const isTransitioningToCompleted = body.status === "Completed" && beforeStatus !== "Completed";
      const isTransitioningToPendingInspection = body.status === "Pending Inspection" && beforeStatus !== "Pending Inspection";
      if (beforeStatus === "Completed" && body.status && body.status !== "Completed") {
        return { error: err("Completed maintenance records cannot be reopened.", 409) };
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
          return { error: err("Only a Fleet Manager or Admin can approve maintenance completion.", 403) };
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
          return { error: err("The person who completed this repair cannot approve its completion.", 403) };
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

      // Rule 3 — per-role transition map (status-changing PUTs only). It runs
      // after the completion role guard above, so a mechanic attempting
      // Completed still gets that guard's 403 rather than this 409.
      if (body.status && body.status !== beforeStatus) {
        const allowed = (isMechanic ? MECHANIC_TRANSITIONS : STAFF_TRANSITIONS)[beforeStatus] || [];
        if (!allowed.includes(body.status)) {
          return { error: err(`Cannot transition from ${beforeStatus} to ${body.status}.`, 409) };
        }
      }

      // Rules C1/C3 (2026-10-06) — terminal freeze: Completed and Cancelled
      // rows accept no PUT except a staff archive via deleted_at. Mechanics
      // never reach the archive path: deleted_at was stripped by Rule 2, so
      // the freeze always fires for them on terminal rows.
      if ((beforeStatus === "Completed" || beforeStatus === "Cancelled") && !body.deleted_at) {
        return { error: err(`${beforeStatus} maintenance records are read-only.`, 409) };
      }

      // Rule 5 — server stamps.
      // Scheduled → In Progress starts the repair clock, once: never overwrite.
      if (body.status === "In Progress" && beforeStatus === "Scheduled" && beforeRow.repair_started_at == null) {
        sets.push(`repair_started_at = CURRENT_TIMESTAMP`);
      }

      // Assigning a mechanic stamps the assignment moment. Only staff reach
      // here with assigned_mechanic_id (mechanics have it stripped by Rule 2).
      if (!isMechanic && body.assigned_mechanic_id !== undefined && body.assigned_mechanic_id !== null && body.assigned_mechanic_id !== "") {
        sets.push(`assigned_at = CURRENT_TIMESTAMP`);
      }

      // Returning a record to In Progress is a rejection: it requires a reason.
      if (beforeStatus === "Pending Inspection" && body.status === "In Progress") {
        const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : body.rejection_reason;
        if (!reason) {
          return { error: err("A rejection reason is required to return a record to In Progress.", 400) };
        }
      }

      values.push(id);
      const idParamIndex = values.length;

      const { rows } = await tx.query(
        `UPDATE vehiclemaintenance SET ${sets.join(", ")}
        WHERE maintenance_id = $${idParamIndex} AND deleted_at IS NULL RETURNING *`,
        values
      );
      if (!rows[0]) return { error: err("Maintenance record not found", 404) };
      const action = rows[0].deleted_at
        ? "maintenance_archived"
        : isTransitioningToCompleted
          ? "maintenance_completed"
          : "maintenance_updated";
      await writeAuditRequired(tx, req, session, {
        action,
        resource: "vehiclemaintenance",
        resourceId: rows[0].maintenance_id,
        oldValues: { status: beforeStatus },
        newValues: { changed_fields: [...seen], status: rows[0].status, source_incident_id: rows[0].source_incident_id },
      });
      return { row: rows[0], beforeStatus };
    });
    if (updateResult.error) return updateResult.error;
    const beforeStatus = updateResult.beforeStatus;
    const rows = [updateResult.row];
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
