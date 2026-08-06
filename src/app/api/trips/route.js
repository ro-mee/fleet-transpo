import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.deleted_at IS NULL`;
    const params = []; let idx = 1;
    const status = sp.get("status") || sp.get("trip_status"); if (status) { sql += ` AND t.trip_status = $${idx++}`; params.push(status); }
    const vid = sp.get("vehicle_id"); if (vid) { sql += ` AND t.vehicle_id = $${idx++}`; params.push(+vid); }
    const did = sp.get("driver_id"); if (did) { sql += ` AND t.driver_id = $${idx++}`; params.push(+did); }
    const fd = sp.get("from_date"); if (fd) { sql += ` AND t.start_time >= $${idx++}`; params.push(fd); }
    const td = sp.get("to_date"); if (td) { sql += ` AND t.start_time <= $${idx++}`; params.push(td); }
    sql += " ORDER BY t.created_at DESC";
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "0", 10) || 0, 0), 500);
    if (limit > 0) { sql += ` LIMIT $${idx++}`; params.push(limit); }
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO trips (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
