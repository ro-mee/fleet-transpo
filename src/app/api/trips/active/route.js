import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `t.*, r.origin, r.destination, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(ds.*) as dispatchschedules, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location`;
const JOINS = `FROM trips t LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON t.driver_id = d.driver_id LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id LEFT JOIN routes r ON t.route_id = r.route_id LEFT JOIN locations ol ON r.origin_location_id = ol.location_id LEFT JOIN locations dl ON r.destination_location_id = dl.location_id`;

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
      `SELECT ${JOIN_SELECT} ${JOINS} WHERE t.trip_status IN ('Dispatched','Driver Accepted','Trip Started','En Route','Arrived') AND t.deleted_at IS NULL ${driverFilter} ORDER BY t.start_time DESC`,
      params
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
