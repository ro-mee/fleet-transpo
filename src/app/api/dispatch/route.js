import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus } from "@/services/status.service";

const JOIN_SELECT = `ds.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(vr.*) as vehiclereservations, row_to_json(r.*) as routes`;
const JOINS = `FROM dispatchschedules ds LEFT JOIN vehicles v ON ds.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON ds.driver_id = d.driver_id LEFT JOIN vehiclereservations vr ON ds.reservation_id = vr.reservation_id LEFT JOIN routes r ON ds.route_id = r.route_id`;

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT ${JOIN_SELECT} ${JOINS} WHERE ds.deleted_at IS NULL`;
    const params = []; let idx = 1;
    const status = sp.get("status"); if (status) { sql += ` AND ds.status = $${idx++}`; params.push(status); }
    const date = sp.get("date"); if (date) { sql += ` AND ds.scheduled_departure >= $${idx} AND ds.scheduled_departure <= $${idx+1}`; params.push(`${date}T00:00:00`, `${date}T23:59:59`); idx += 2; }
    const dn = sp.get("dispatch_number"); if (dn) { sql += ` AND ds.dispatch_number ILIKE $${idx++}`; params.push(`%${dn}%`); }
    sql += " ORDER BY ds.scheduled_departure DESC";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO dispatchschedules (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    const p = []; if (rows[0]?.vehicle_id) p.push(syncVehicleStatus(rows[0].vehicle_id)); if (rows[0]?.driver_id) p.push(syncDriverStatus(rows[0].driver_id)); await Promise.all(p);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
