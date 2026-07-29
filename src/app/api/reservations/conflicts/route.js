import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const vehicleId = sp.get("vehicle_id"), date = sp.get("date"), pickupTime = sp.get("pickup_time"), estimatedReturn = sp.get("estimated_return");
    if (!vehicleId || !date) return ok([]);
    const { rows } = await query(`SELECT reservation_id, pickup_time, estimated_return_time FROM vehiclereservations WHERE vehicle_id = $1 AND reservation_date = $2 AND status IN ('Pending','Approved','Dispatched') AND reservation_id IS NOT NULL`, [vehicleId, date]);
    if (!pickupTime || !estimatedReturn) return ok(rows);
    const pickup = new Date(`1970-01-01T${pickupTime}`), ret = new Date(`1970-01-01T${estimatedReturn}`);
    return ok(rows.filter(r => { const rp = new Date(`1970-01-01T${r.pickup_time}`), rr = new Date(`1970-01-01T${r.estimated_return_time}`); return pickup < rr && ret > rp; }));
  } catch (e) { return handleError(e); }
}
