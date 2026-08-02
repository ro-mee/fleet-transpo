import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { findReservationConflicts } from "@/lib/scheduling/conflicts";

// Advisory conflict check for the booking UI. Uses the same overlap logic as
// the enforcing check in POST /api/reservations (src/lib/scheduling/conflicts).
export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const vehicleId = sp.get("vehicle_id");
    const driverId = sp.get("driver_id");
    const date = sp.get("date");
    const pickupTime = sp.get("pickup_time");
    const returnTime = sp.get("estimated_return");
    if ((!vehicleId && !driverId) || !date) return ok([]);
    const rows = await findReservationConflicts({
      vehicleId: vehicleId || null,
      driverId: driverId || null,
      date,
      pickupTime,
      returnTime,
    });
    return ok(rows);
  } catch (e) { return handleError(e); }
}
