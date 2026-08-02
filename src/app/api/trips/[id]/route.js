import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `t.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(ds.*) as dispatchschedules, row_to_json(r.*) as routes, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location`;
const JOINS = `FROM trips t LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON t.driver_id = d.driver_id LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id LEFT JOIN routes r ON t.route_id = r.route_id LEFT JOIN locations ol ON t.origin_location_id = ol.location_id LEFT JOIN locations dl ON t.destination_location_id = dl.location_id`;

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT ${JOIN_SELECT} ${JOINS} WHERE t.trip_id = $1 AND t.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE trips SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE trip_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
