import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { writeAuditRequired } from "@/lib/audit";

// The API's field names, kept as-is so existing clients do not break, mapped to
// the columns that actually exist. Before this map, the schema accepted
// next_service_date / next_service_mileage / technician_name /
// service_center_name / notes — none of which are columns — and assigned_to /
// completed_by, which have no column at all. Every such write failed at the DB.
//
// The real column names are accepted too, because the maintenance page posts
// service_provider / service_center / remarks directly rather than the aliases.
// An alias-only allowlist would silently drop three fields on every create and
// edit from the only UI that writes this table — the raw-key build this
// replaces happened to pass them through.
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
};

// Lean projection for the paginated register. Only the columns the maintenance
// page renders + the detail dialog needs, instead of `vm.*` + `row_to_json(v.*)`.
// Task 4b adds the 9 timeline/evidence keys (assigned_at, repair_started_at,
// repair_completed_at, repair_completed_by, diagnosis, parts_replaced,
// labor_hours, rejection_reason, completed_date — completed_date was already
// here) plus source_inspection_id, so the Task 6 detail page renders real
// timeline/dots instead of "Not recorded". Mechanic AND staff rows carry the
// same superset (read-only; no new mutation surface).
const MT_LIST_SELECT = `
  vm.maintenance_id, vm.vehicle_id, vm.maintenance_type, vm.maintenance_date,
  vm.completed_date, vm.status, vm.priority, vm.cost, vm.service_provider,
  vm.service_center, vm.mileage_at_service, vm.description, vm.remarks, vm.created_at,
  vm.source_incident_id, vm.source_inspection_id,
  vm.assigned_at, vm.repair_started_at, vm.repair_completed_at, vm.repair_completed_by,
  vm.diagnosis, vm.parts_replaced, vm.labor_hours, vm.rejection_reason,
  (vm.status = 'Scheduled' AND vm.maintenance_date < (NOW() AT TIME ZONE 'Asia/Manila')::date) AS is_overdue,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'vehicle_name', v.vehicle_name)
  END AS vehicles
`;

const MT_FROM = `
  FROM vehiclemaintenance vm
  LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
`;

// Task 4 — mechanic reads always go through the lean projection above: `vm.*`
// + `row_to_json(v.*)` leaks purchase_price, image_url and the full vehicle
// row. The mechanic branch additionally carries its own assignment id so every
// returned row proves its ownership; staff keep MT_LIST_SELECT byte-identical.
const MT_MECHANIC_SELECT = `${MT_LIST_SELECT}, vm.assigned_mechanic_id`;

function mtLeanListSQL(select, where, orderBy, limitSql) {
  return `SELECT ${select} ${MT_FROM} ${where} ${orderBy}${limitSql}`;
}

// Whitelist of sortable columns for the register. Maps the TanStack accessor id
// to a SQL expression so user input never reaches ORDER BY.
const MT_SORTABLE = {
  "vehicles.plate_number": "v.plate_number",
  maintenance_type: "vm.maintenance_type",
  maintenance_date: "vm.maintenance_date",
  status: "vm.status",
  priority: "vm.priority",
  cost: "vm.cost",
  service_provider: "vm.service_provider",
};

// Stat-card totals, computed server-side so the register never needs the whole set.
const MT_COUNTS_SQL = `
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE vm.status = 'Scheduled') AS scheduled,
    count(*) FILTER (
      WHERE vm.status = 'Scheduled'
        AND vm.maintenance_date < (NOW() AT TIME ZONE 'Asia/Manila')::date
    ) AS overdue,
    count(*) FILTER (WHERE vm.status IN ('In Progress', 'Pending Inspection')) AS "inProgress",
    COALESCE(SUM(vm.cost), 0) AS total_cost
  FROM vehiclemaintenance vm WHERE vm.deleted_at IS NULL
`;

const maintenanceWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  maintenance_date: { required: true, type: "date", label: "Maintenance date", validate: maintenanceDateRule },
  maintenance_type: { required: true, maxLength: 50, label: "Type" },
  description: { maxLength: 1000, label: "Description" },
  cost: { type: "positiveNumber", label: "Cost" },
  status: { maxLength: 30, label: "Status" },
  // Bounded, and completed_date carries its own no-future rule, because these
  // are the only two body fields recomputeVehicleSchedule feeds into the
  // vehicle's next_service_date / next_service_mileage — and that write is
  // clamped forward-only, so an out-of-range value here is not correctable by
  // filing a later record. Operations roles may provide these inputs; driver
  // self-service maintenance writes are not permitted here.
  mileage_at_service: { type: "positiveNumber", label: "Mileage at service", max: MAX_ODOMETER_KM },
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
  technician_name: { maxLength: 255, label: "Technician name" },
  service_center_name: { maxLength: 255, label: "Service center" },
  priority: { maxLength: 30, label: "Priority" },
  completed_date: { type: "date", label: "Completed date", validate: completionDateRule },
  notes: { maxLength: 1000, label: "Notes" },
  // Same fields under their column names, so the page's payload is validated as
  // strictly as an alias-using client's. validatePayload only walks the schema's
  // own keys, so without these three the page's values reach SQL unchecked.
  next_schedule_date: { type: "date", label: "Next service date" },
  next_schedule_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
  service_provider: { maxLength: 255, label: "Technician name" },
  service_center: { maxLength: 255, label: "Service center" },
  remarks: { maxLength: 1000, label: "Notes" },
};

export async function GET(req) {
  try {
    const session = await requirePermission(req, "maintenance", "read");
    const { searchParams } = new URL(req.url);
    // Task 4 — mechanics read only their own assigned rows (fail closed:
    // unassigned NULL rows match nobody). Staff filters below are untouched.
    const isMechanic = normalizeRoleName(session?.user?.role) === "mechanic";

    let where = " WHERE vm.deleted_at IS NULL";
    const params = [];
    let idx = 1;

    if (isMechanic) { where += ` AND vm.assigned_mechanic_id = $${idx++}`; params.push(session.user.employeeId); }

    const vehicle_id = searchParams.get("vehicle_id");
    if (vehicle_id) { where += ` AND vm.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const source_incident_id = searchParams.get("source_incident_id");
    if (/^\d+$/.test(source_incident_id || "")) { where += ` AND vm.source_incident_id = $${idx++}`; params.push(+source_incident_id); }

    const status = searchParams.get("status");
    if (status) { where += ` AND vm.status = $${idx++}`; params.push(status); }

    const from_date = searchParams.get("from_date");
    if (from_date) { where += ` AND vm.maintenance_date >= $${idx++}`; params.push(from_date); }

    const to_date = searchParams.get("to_date");
    if (to_date) { where += ` AND vm.maintenance_date <= $${idx++}`; params.push(to_date); }

    const search = searchParams.get("search");
    if (search) {
      where += ` AND (v.plate_number ILIKE $${idx} OR vm.service_provider ILIKE $${idx} OR vm.service_center ILIKE $${idx} OR vm.maintenance_type ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const page = parseInt(searchParams.get("page"));
    const ps = parseInt(searchParams.get("pageSize"));
    if (page && ps) {
      // Paginated mode: lean projection + sort + server totals/counts. Returns
      // `{ rows, total, counts }` so the table + stat cards don't need the set.
      const whereCount = params.length;
      const sort = searchParams.get("sort");
      const sortDir = (searchParams.get("sortDir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      const orderBy = sort && MT_SORTABLE[sort]
        ? ` ORDER BY ${MT_SORTABLE[sort]} ${sortDir}`
        : " ORDER BY vm.maintenance_date DESC";

      const [rowsRes, totalRes, countsRes] = await Promise.all([
        query(
          mtLeanListSQL(isMechanic ? MT_MECHANIC_SELECT : MT_LIST_SELECT, where, orderBy, ` LIMIT $${idx++} OFFSET $${idx++}`),
          [...params, ps, (page - 1) * ps]
        ),
        query(`SELECT count(*) AS total ${MT_FROM} ${where}`, params.slice(0, whereCount)),
        // Mechanic stat cards are scoped by the same assignment; staff totals stay global.
        isMechanic
          ? query(`${MT_COUNTS_SQL} AND vm.assigned_mechanic_id = $1`, [session.user.employeeId])
          : query(MT_COUNTS_SQL),
      ]);

      const c = countsRes.rows[0] || {};
      return ok({
        rows: rowsRes.rows,
        total: Number(totalRes.rows[0]?.total) || 0,
        page,
        pageSize: ps,
        counts: {
          total: Number(c.total) || 0,
          scheduled: Number(c.scheduled) || 0,
          overdue: Number(c.overdue) || 0,
          inProgress: Number(c.inProgress) || 0,
          totalCost: Number(c.total_cost) || 0,
        },
      });
    }

    // Non-paginated: mechanics take the same lean branch (never the fat
    // select below); staff callers keep the full array, byte-identical.
    if (isMechanic) {
      const { rows } = await query(
        mtLeanListSQL(MT_MECHANIC_SELECT, where, " ORDER BY vm.maintenance_date DESC", ""),
        params
      );
      return ok(rows);
    }

    // Non-paginated: full array (other callers).
    const { rows } = await query(
      `SELECT vm.*, row_to_json(v.*) as vehicles
       ${MT_FROM} ${where} ORDER BY vm.maintenance_date DESC`,
      params
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "maintenance", "create");
    const body = await parseBody(req);

    const errors = validateBody(body, maintenanceWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // P1 Fix: Force all new records to be Scheduled.
    // Completed status can only be achieved via the PUT state-machine.
    body.status = "Scheduled";
    delete body.completed_by;
    delete body.completed_at;

    // Build from the allowlist, not from Object.keys(body). Previously any
    // unknown body key was interpolated straight into the column list.
    // Deduplicated by column: an alias and its column name both map to one
    // column, and naming it twice makes Postgres reject the whole INSERT.
    // First declared spelling wins, so aliases take precedence.
    const columns = [];
    const values = [];
    const seen = new Set();
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (body[field] === undefined) continue;
      if (seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
      values.push(body[field] === "" ? null : body[field]);
    }
    if (columns.length === 0) return err("No writable fields were provided", 400);

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const row = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO vehiclemaintenance (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      await writeAuditRequired(tx, req, session, {
        action: "maintenance_created",
        resource: "vehiclemaintenance",
        resourceId: rows[0]?.maintenance_id,
        newValues: {
          vehicle_id: rows[0]?.vehicle_id,
          status: rows[0]?.status,
          changed_fields: columns,
          source_incident_id: rows[0]?.source_incident_id,
        },
      });
      return rows[0];
    });
    if (row?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(row.vehicle_id);
      await recomputeVehicleSchedule(row.vehicle_id, row);
    }
    return ok(row, 201);
  } catch (e) { return handleError(e); }
}
