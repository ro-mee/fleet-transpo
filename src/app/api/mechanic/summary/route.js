import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { normalizeRoleName } from "@/lib/auth/role-names";

// Today's Line payload for the mechanic workspace: { counts, upNext, queue,
// attention, upcoming }. The optional status query filters only the queue;
// counts and upNext stay independent of the selected filter.
//
// Mechanic-only. Every statement is scoped to the caller's employee id over
// assigned, non-deleted rows. The vehicle projection stays lean and adds only
// image_url for the selected mechanic vehicle snapshot.

const SUMMARY_COUNTS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE vm.status IN ('Scheduled', 'In Progress', 'Pending Inspection')) AS assigned,
    COUNT(*) FILTER (WHERE vm.status = 'Scheduled') AS scheduled,
    COUNT(*) FILTER (WHERE vm.status = 'In Progress') AS "inProgress",
    COUNT(*) FILTER (WHERE vm.status = 'Pending Inspection') AS "waitingApproval",
    COUNT(*) FILTER (WHERE vm.priority IN ('High', 'Emergency') AND vm.status IN ('Scheduled', 'In Progress')) AS urgent,
    COUNT(*) FILTER (WHERE vm.status IN ('Scheduled', 'In Progress', 'Pending Inspection') AND vm.maintenance_date < CURRENT_DATE) AS overdue
     FROM vehiclemaintenance vm
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
`;

// Priority-ranked, oldest-first: Emergency/High head the line, then earliest
// maintenance_date.
const LINE_ORDER = `ORDER BY
     CASE vm.priority WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 ELSE 2 END,
     vm.maintenance_date ASC`;

// Queue rows carry the same timeline/evidence keys as the register lean
// projection, plus source ids for display-only problem context. The optional
// vehicle image is the only additional vehicle field.
const SUMMARY_ROW_SELECT = `
  vm.maintenance_id, vm.vehicle_id, vm.maintenance_type, vm.maintenance_date,
  vm.completed_date, vm.status, vm.priority, vm.description, vm.diagnosis,
  vm.mileage_at_service,
  vm.parts_replaced, vm.labor_hours, vm.rejection_reason,
  vm.assigned_at, vm.repair_started_at, vm.repair_completed_at, vm.repair_completed_by,
  vm.source_inspection_id, vm.source_incident_id,
  ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(vm.repair_started_at, vm.assigned_at, vm.created_at))) / 60)::int AS "ageMinutes",
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'vehicle_name', v.vehicle_name, 'image_url', v.image_url)
  END AS vehicle
`;

// My Line supports all active mechanic statuses. A requested status is
// validated before choosing the parameterized query below.
const SUMMARY_QUEUE_SQL = `
  SELECT ${SUMMARY_ROW_SELECT}
    FROM vehiclemaintenance vm
    LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
     AND vm.status IN ('Scheduled', 'In Progress', 'Pending Inspection')
   ${LINE_ORDER}
   LIMIT 10
`;

const SUMMARY_FILTERED_QUEUE_SQL = `
  SELECT ${SUMMARY_ROW_SELECT}
    FROM vehiclemaintenance vm
    LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
     AND vm.status = $2
   ${LINE_ORDER}
   LIMIT 10
`;

// upNext is always actionable, even while My Line is filtered to Pending
// Inspection. That state belongs to the manager's inspection queue.
const SUMMARY_UP_NEXT_SQL = `
  SELECT ${SUMMARY_ROW_SELECT}
    FROM vehiclemaintenance vm
    LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
   WHERE vm.deleted_at IS NULL
     AND vm.assigned_mechanic_id = $1
     AND vm.status IN ('Scheduled', 'In Progress')
   ${LINE_ORDER}
   LIMIT 1
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
    description: r.description ?? null,
    diagnosis: r.diagnosis ?? null,
    mileage_at_service: r.mileage_at_service ?? null,
    parts_replaced: r.parts_replaced ?? null,
    labor_hours: r.labor_hours ?? null,
    rejection_reason: r.rejection_reason ?? null,
    assigned_at: r.assigned_at ?? null,
    repair_started_at: r.repair_started_at ?? null,
    repair_completed_at: r.repair_completed_at ?? null,
    repair_completed_by: r.repair_completed_by ?? null,
    source_inspection_id: r.source_inspection_id ?? null,
    source_incident_id: r.source_incident_id ?? null,
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
    const { searchParams } = new URL(req.url);
    const requestedStatus = searchParams.get("status");
    const statusFilter = ["Scheduled", "In Progress", "Pending Inspection"].includes(requestedStatus)
      ? requestedStatus
      : null;

    const [countsRes, queueRes, attentionRes, upNextRes] = await Promise.all([
      query(SUMMARY_COUNTS_SQL, [me]),
      statusFilter
        ? query(SUMMARY_FILTERED_QUEUE_SQL, [me, statusFilter])
        : query(SUMMARY_QUEUE_SQL, [me]),
      query(SUMMARY_ATTENTION_SQL, [me]),
      query(SUMMARY_UP_NEXT_SQL, [me]),
    ]);

    const c = countsRes.rows[0] || {};
    const queue = queueRes.rows.map(shapeWorkOrder);
    return ok({
      counts: {
        assigned: Number(c.assigned) || 0,
        scheduled: Number(c.scheduled) || 0,
        inProgress: Number(c.inProgress) || 0,
        waitingApproval: Number(c.waitingApproval) || 0,
        urgent: Number(c.urgent) || 0,
        overdue: Number(c.overdue) || 0,
      },
      upNext: upNextRes.rows[0] ? shapeWorkOrder(upNextRes.rows[0]) : null,
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
