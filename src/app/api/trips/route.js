import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `t.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(ds.*) as dispatchschedules, row_to_json(r.*) as routes, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location`;
const JOINS = `FROM trips t LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON t.driver_id = d.driver_id LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id LEFT JOIN routes r ON t.route_id = r.route_id LEFT JOIN locations ol ON t.origin_location_id = ol.location_id LEFT JOIN locations dl ON t.destination_location_id = dl.location_id`;

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT ${JOIN_SELECT} ${JOINS} WHERE t.deleted_at IS NULL`;
    const params = []; let idx = 1;
    const status = sp.get("status"); if (status) { sql += ` AND t.trip_status = $${idx++}`; params.push(status); }
    const vid = sp.get("vehicle_id"); if (vid) { sql += ` AND t.vehicle_id = $${idx++}`; params.push(+vid); }
    const did = sp.get("driver_id"); if (did) { sql += ` AND t.driver_id = $${idx++}`; params.push(+did); }
    const fd = sp.get("from_date"); if (fd) { sql += ` AND t.start_time >= $${idx++}`; params.push(fd); }
    const td = sp.get("to_date"); if (td) { sql += ` AND t.start_time <= $${idx++}`; params.push(td); }
    sql += " ORDER BY t.created_at DESC";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO trips (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
