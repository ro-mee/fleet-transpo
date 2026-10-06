import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { normalizeRoleName } from "@/lib/auth/role-names";

// Task 4 — Today's Line payload for the mechanic workspace. Task 6 consumes
// this shape verbatim: { counts, upNext, queue, attention, upcoming }.
//
// Mechanic-only. Every statement is scoped to the caller's employee id over
// assigned, non-deleted rows, through the same lean vehicle projection as the
// register (plate_number + vehicle_name ONLY — never purchase_price,
// image_url or the full vehicle row).

const SUMMARY_COUNTS_SQL = `
  SELECT
    COUNT(*) AS assigned,
    COUNT(*) FILTER (WHERE vm.status = 'In Progress') AS "inProgress",
    COUNT(*) FILTER (WHERE vm.status = 'Pending Inspection') AS "waitingApproval",
    COUNT(*) FILTER (WHERE vm.priority IN ('High', 'Emergency') AND vm.status IN ('Scheduled', 'In Progress')) AS urgent,
    COUNT(*) FILTER (WHERE vm.status IN ('Scheduled', 'In Progress') AND vm.maintenance_date < CURRENT_DATE) AS overdue
    FROM vehiclemaintenance vm
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
`;

// Priority-ranked, oldest-first: Emergency/High head the line, then earliest
// maintenance_date. Shared by the queue and upNext (upNext is queue[0], so
// the two can never disagree).
const LINE_ORDER = `ORDER BY
     CASE vm.priority WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 ELSE 2 END,
     vm.maintenance_date ASC`;

// Task 4b: queue/upNext rows carry the same 9 timeline/evidence keys as the
// register lean projection (plus source_inspection_id so Task 6 links problems
// both ways). Read-only superset; no new mutation surface.
const SUMMARY_ROW_SELECT = `
  vm.maintenance_id, vm.vehicle_id, vm.maintenance_type, vm.maintenance_date,
  vm.completed_date, vm.status, vm.priority, vm.diagnosis,
  vm.parts_replaced, vm.labor_hours, vm.rejection_reason,
  vm.assigned_at, vm.repair_started_at, vm.repair_completed_at, vm.repair_completed_by,
  vm.source_inspection_id,
  ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(vm.repair_started_at, vm.assigned_at, vm.created_at))) / 60)::int AS "ageMinutes",
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'vehicle_name', v.vehicle_name)
  END AS vehicle
`;

// upNext draws from this same actionable set (Scheduled / In Progress): a
// Pending Inspection row awaits the manager, and a Completed/Cancelled row is
// terminal — neither is "up next" for the mechanic's line.
const SUMMARY_QUEUE_SQL = `
  SELECT ${SUMMARY_ROW_SELECT}
    FROM vehiclemaintenance vm
    LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
     AND vm.status IN ('Scheduled', 'In Progress')
   ${LINE_ORDER}
   LIMIT 10
`;

const SUMMARY_ATTENTION_SQL = `
  SELECT notification_id AS id, title, message, type, reference_type, reference_id,
         created_at, is_read
    FROM notifications
   WHERE employee_id = $1
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 8
`;

function shapeWorkOrder(r) {
  return {
    maintenance_id: r.maintenance_id,
    vehicle_id: r.vehicle_id,
    maintenance_type: r.maintenance_type,
    maintenance_date: r.maintenance_date,
    completed_date: r.completed_date ?? null,
    status: r.status,
    priority: r.priority,
    diagnosis: r.diagnosis ?? null,
    parts_replaced: r.parts_replaced ?? null,
    labor_hours: r.labor_hours ?? null,
    rejection_reason: r.rejection_reason ?? null,
    assigned_at: r.assigned_at ?? null,
    repair_started_at: r.repair_started_at ?? null,
    repair_completed_at: r.repair_completed_at ?? null,
    repair_completed_by: r.repair_completed_by ?? null,
    source_inspection_id: r.source_inspection_id ?? null,
    ageMinutes: r.ageMinutes != null ? Number(r.ageMinutes) : null,
    vehicle: r.vehicle ?? null,
  };
}

function shapeNotification(r) {
  return {
    id: r.id,
    title: r.title,
    message: r.message ?? null,
    type: r.type,
    reference_type: r.reference_type ?? null,
    reference_id: r.reference_id ?? null,
    created_at: r.created_at,
    is_read: Boolean(r.is_read),
  };
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "maintenance", "read");
    if (normalizeRoleName(session?.user?.role) !== "mechanic") {
      return err("Mechanic workspace only.", 403);
    }
    const me = session.user.employeeId;

    const [countsRes, queueRes, attentionRes] = await Promise.all([
      query(SUMMARY_COUNTS_SQL, [me]),
      query(SUMMARY_QUEUE_SQL, [me]),
      query(SUMMARY_ATTENTION_SQL, [me]),
    ]);

    const c = countsRes.rows[0] || {};
    const queue = queueRes.rows.map(shapeWorkOrder);
    return ok({
      counts: {
        assigned: Number(c.assigned) || 0,
        inProgress: Number(c.inProgress) || 0,
        waitingApproval: Number(c.waitingApproval) || 0,
        urgent: Number(c.urgent) || 0,
        overdue: Number(c.overdue) || 0,
      },
      upNext: queue[0] ?? null,
      queue,
      attention: attentionRes.rows.map(shapeNotification),
      // No clean server-side getter exists without side effects: the only
      // reader is the client fetch wrapper getPredictiveMaintenance
      // (src/services/maintenance.service.js), which a route cannot call.
      // Return [] rather than build a new predictor.
      upcoming: [],
    });
  } catch (e) { return handleError(e); }
}
