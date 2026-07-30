import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id, dispatch_id FROM trips WHERE trip_id = $1 LIMIT 1`, [id]);
    const dist = body.end_odometer - (body.start_odometer || 0);
    const { rows } = await query(`UPDATE trips SET trip_status = 'Completed', end_time = NOW(), end_odometer = $1, distance = $2 WHERE trip_id = $3 RETURNING *`, [body.end_odometer, dist > 0 ? dist : body.distance, id]);
    if (!rows[0]) return err("Trip not found", 404);
    const p = [];
    if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
    if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
    if (before[0]?.dispatch_id) {
      p.push(query(`UPDATE dispatchschedules SET status = 'Completed' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
      p.push(syncDispatchReservation(before[0].dispatch_id));
    }
    await Promise.all(p);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
