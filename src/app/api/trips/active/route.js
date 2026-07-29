import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `t.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(ds.*) as dispatchschedules, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location`;
const JOINS = `FROM trips t LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON t.driver_id = d.driver_id LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id LEFT JOIN locations ol ON t.origin_location_id = ol.location_id LEFT JOIN locations dl ON t.destination_location_id = dl.location_id`;

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows } = await query(`SELECT ${JOIN_SELECT} ${JOINS} WHERE t.trip_status IN ('Dispatched','Driver Accepted','Trip Started','En Route','Arrived') AND t.deleted_at IS NULL ORDER BY t.start_time DESC`);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
