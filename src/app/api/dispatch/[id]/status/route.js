import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation, ensureTripForDispatch } from "@/services/status.service";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`, [id]);
    const { rows } = await query(`UPDATE dispatchschedules SET status = $1 WHERE dispatch_id = $2 RETURNING *`, [body.status, id]);
    if (!rows[0]) return err("Dispatch not found", 404);
    const p = []; if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id)); if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id)); p.push(syncDispatchReservation(id)); if (body.status === "Scheduled" || body.status === "In Progress") p.push(ensureTripForDispatch(id)); await Promise.all(p);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
