import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

export async function GET(req) {
  try {
    const session = await requireAuth(req, ROLES);

    // Operations roles see the whole active fleet; a driver sees only their own
    // trips. Without this filter the mobile app would receive every active trip
    // in the company.
    const scoped = session.user.role === "driver";
    const params = scoped ? [session.user.driverId] : [];
    const driverFilter = scoped ? `AND t.driver_id = $1` : "";

    const { rows } = await query(
      `SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.trip_status IN ('Dispatched','Driver Accepted','Trip Started','At Pickup','Passenger Onboard','En Route','Drop-off','Arrived','In Progress') AND t.deleted_at IS NULL ${driverFilter} ORDER BY t.start_time DESC`,
      params
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
