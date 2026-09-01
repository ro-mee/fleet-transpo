import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { listReservationEvents } from "@/services/reservation-events.service";
import { loadRequest } from "@/services/reservation-lifecycle.service";

// Read a request's timeline (Phase 15).
//
// Read-only and broadly readable: anyone who can see the queue can see why a
// request is where it is, including management.
export async function GET(req, { params }) {
  try {
    await requirePermission(req, "reservations", "read");
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    const events = await listReservationEvents(id);
    return ok(events);
  } catch (e) { return handleError(e); }
}
