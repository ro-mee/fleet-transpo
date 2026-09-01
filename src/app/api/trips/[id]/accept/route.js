import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { query } from "@/lib/db";
import { setTripStatus } from "@/services/transition.service";
import { cancelTrip } from "@/services/trip-lifecycle.service";
import { TRIP_STATUS } from "@/lib/constants";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";

// Accept or decline a dispatched trip. Accepting moves Assigned → Driver
// Accepted. Declining transitions to Cancelled (trips have no "Rejected" state).
// Legacy ingest statuses (Pending/Approved/…/Dispatched) are bridged through
// Assigned first, mirroring the state machine.
export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    if (typeof body.accept !== "boolean") {
      return err("accept field is required and must be true or false", 400);
    }
    await assertTripOwnership(session, id);

    if (body.accept) {
      const { rows: before } = await query(
        `SELECT trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
        [id]
      );
      const from = before[0]?.trip_status;
      if (!from) return err("Trip not found", 404);

      // Bridge legacy ingest statuses through Assigned into the live chain.
      if (from !== TRIP_STATUS.ASSIGNED && canTransitionTrip(from, TRIP_STATUS.ASSIGNED).ok) {
        await setTripStatus({ tripId: id, to: TRIP_STATUS.ASSIGNED, session });
      }
      return ok(await setTripStatus({ tripId: id, to: TRIP_STATUS.DRIVER_ACCEPTED, session }));
    }
    return ok(await cancelTrip(id, session, { reason: body.reason }));
  } catch (e) { return handleError(e); }
}
