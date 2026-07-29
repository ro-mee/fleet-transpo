import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";

const JOIN_SELECT = `ds.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(vr.*) as vehiclereservations, row_to_json(r.*) as routes`;
const JOINS = `FROM dispatchschedules ds LEFT JOIN vehicles v ON ds.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON ds.driver_id = d.driver_id LEFT JOIN vehiclereservations vr ON ds.reservation_id = vr.reservation_id LEFT JOIN routes r ON ds.route_id = r.route_id`;

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT ${JOIN_SELECT} ${JOINS} WHERE ds.dispatch_id = $1 AND ds.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Dispatch not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`, [id]);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE dispatchschedules SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE dispatch_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Dispatch not found", 404);
    const vid = body.vehicle_id || before[0]?.vehicle_id, did = body.driver_id || before[0]?.driver_id;
    const p = []; if (vid) p.push(syncVehicleStatus(vid)); if (did) p.push(syncDriverStatus(did)); if (rows[0]?.reservation_id) p.push(syncDispatchReservation(id)); await Promise.all(p);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
