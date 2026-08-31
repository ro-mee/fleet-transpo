import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

export async function GET(req) {
  try {
    const session = await requireAuth(req, ROLES);

    // Operations roles see the whole active fleet; a driver sees only their own
    // trips. Without this filter the mobile app would receive every active trip
    // in the company.
    const scoped = session.user.role === "driver";
    const params = [LIVE_TRIP_STATUSES];
    const driverFilter = scoped ? `AND t.driver_id = $2` : "";
    if (scoped) params.push(session.user.driverId);

    const { rows } = await query(
      `SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.trip_status = ANY($1) AND t.deleted_at IS NULL ${driverFilter} ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC`,
      params
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
