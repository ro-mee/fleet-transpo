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

    let sql = `SELECT vm.*, row_to_json(v.*) as vehicles
               FROM vehiclemaintenance vm
               LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
               WHERE vm.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const vehicle_id = searchParams.get("vehicle_id");
    if (vehicle_id) { sql += ` AND vm.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const status = searchParams.get("status");
    if (status) { sql += ` AND vm.status = $${idx++}`; params.push(status); }

    const from_date = searchParams.get("from_date");
    if (from_date) { sql += ` AND vm.maintenance_date >= $${idx++}`; params.push(from_date); }

    const to_date = searchParams.get("to_date");
    if (to_date) { sql += ` AND vm.maintenance_date <= $${idx++}`; params.push(to_date); }

    sql += " ORDER BY vm.maintenance_date DESC";

    const { rows } = await query(sql, params);
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
