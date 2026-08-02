import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus } from "@/services/status.service";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id FROM vehiclereservations WHERE reservation_id = $1 LIMIT 1`, [id]);
    const updates = { status: "Cancelled" };
    if (body?.reason) updates.cancellation_reason = body.reason;
    const k = Object.keys(updates), v = Object.values(updates);
    const { rows } = await query(`UPDATE vehiclereservations SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE reservation_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Reservation not found", 404);
    if (before[0]?.vehicle_id) await syncVehicleStatus(before[0].vehicle_id);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
