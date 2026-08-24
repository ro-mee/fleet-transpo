import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";

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

// Who is allowed to move a vehicle's service schedule by creating a record.
// Deliberately narrower than the POST's own role list, which also admits
// drivers — see the comment on the recompute call in POST.
const SCHEDULE_OWNER_ROLES = ["system_admin", "admin", "fleet_manager"];

// Lean projection for the paginated register. Only the columns the maintenance
// page renders + the detail dialog needs, instead of `vm.*` + `row_to_json(v.*)`.
const MT_LIST_SELECT = `
  vm.maintenance_id, vm.vehicle_id, vm.maintenance_type, vm.maintenance_date,
  vm.completed_date, vm.status, vm.priority, vm.cost, vm.service_provider,
  vm.service_center, vm.mileage_at_service, vm.description, vm.remarks, vm.created_at,
  vm.source_incident_id,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'vehicle_name', v.vehicle_name)
  END AS vehicles
`;

const MT_FROM = `
  FROM vehiclemaintenance vm
  LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
`;

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
    count(*) FILTER (WHERE vm.status = 'In Progress') AS "inProgress",
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
  // filing a later record. POST is open to the driver role, which makes these
  // the lowest-privilege inputs to the whole prediction.
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
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let where = " WHERE vm.deleted_at IS NULL";
    const params = [];
    let idx = 1;

    const vehicle_id = searchParams.get("vehicle_id");
    if (vehicle_id) { where += ` AND vm.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

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
          `SELECT ${MT_LIST_SELECT} ${MT_FROM} ${where} ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, ps, (page - 1) * ps]
        ),
        query(`SELECT count(*) AS total ${MT_FROM} ${where}`, params.slice(0, whereCount)),
        query(MT_COUNTS_SQL),
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
          inProgress: Number(c.inProgress) || 0,
          totalCost: Number(c.total_cost) || 0,
        },
      });
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
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "driver"]);
    const body = await parseBody(req);

    const errors = validateBody(body, maintenanceWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

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
    const { rows } = await query(
      `INSERT INTO vehiclemaintenance (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
      // A record created already Completed advances the vehicle's due-dates —
      // but only when an operations role authored it. Drivers can post here to
      // report a problem they hit on the road, and a driver-authored row with
      // status "Completed" and a mis-keyed odometer would otherwise reach the
      // forward-only clamp in recomputeVehicleSchedule, where a too-high value
      // is permanent through this path. The record is still written and still
      // syncs vehicle status; it just does not move the service schedule until
      // someone who owns the schedule touches it via PUT.
      if (SCHEDULE_OWNER_ROLES.includes(session.user.role)) {
        await recomputeVehicleSchedule(rows[0].vehicle_id, rows[0]);
      }
    }
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
