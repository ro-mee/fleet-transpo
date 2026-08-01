import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertDispatchOwnership } from "@/lib/api/ownership";

const JOIN_SELECT = `ds.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(vr.*) as vehiclereservations, row_to_json(r.*) as routes`;
const JOINS = `FROM dispatchschedules ds LEFT JOIN vehicles v ON ds.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON ds.driver_id = d.driver_id LEFT JOIN vehiclereservations vr ON ds.reservation_id = vr.reservation_id LEFT JOIN routes r ON ds.route_id = r.route_id`;

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

export async function GET(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
    const id = (await params).id;

    // Throws 404 when the dispatch is not the caller's own.
    await assertDispatchOwnership(session, id);

    const { rows } = await query(
      `SELECT ${JOIN_SELECT} ${JOINS} WHERE ds.dispatch_id = $1 AND ds.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!rows[0]) return err("Dispatch not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

// Columns an operations user may set. dispatch_id, dispatch_number, the audit
// columns and deleted_at are all generated or derived and deliberately absent.
const WRITABLE_COLUMNS = [
  "reservation_id",
  "vehicle_id",
  "driver_id",
  "route_id",
  "scheduled_departure",
  "scheduled_arrival",
  "actual_departure",
  "actual_arrival",
  "estimated_distance",
  "estimated_duration",
  "status",
  "priority",
  "notes",
];

// Drivers are not in this route's allowedRoles: requireAuth falls back to
// DEFAULT_ROLES, which is operations-only. Drivers accept/decline through
// /api/mobile/driver/trips/[id]/accept instead, which enforces the status
// transitions that are valid from a phone.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`, [id]);

    // Previously this interpolated Object.keys(body) straight into the UPDATE,
    // so any caller could write deleted_at, dispatch_number or the audit
    // columns. Only known columns are accepted now.
    const columns = [];
    const values = [];
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No updatable fields provided", 400);

    const assignments = columns.map((c, i) => `${c} = $${i + 1}`);
    assignments.push(`updated_at = NOW()`, `updated_by = $${columns.length + 1}`);
    values.push(session.user.employeeId);

    const { rows } = await query(
      `UPDATE dispatchschedules SET ${assignments.join(", ")} WHERE dispatch_id = $${values.length + 1} AND deleted_at IS NULL RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Dispatch not found", 404);
    const vid = body.vehicle_id || before[0]?.vehicle_id, did = body.driver_id || before[0]?.driver_id;
    const p = []; if (vid) p.push(syncVehicleStatus(vid)); if (did) p.push(syncDriverStatus(did)); if (rows[0]?.reservation_id) p.push(syncDispatchReservation(id)); if (rows[0]?.status === "Scheduled" || rows[0]?.status === "In Progress") p.push(ensureTripForDispatch(id)); await Promise.all(p);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
