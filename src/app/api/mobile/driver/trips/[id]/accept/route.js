import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { TRIP_STATUS } from "@/lib/constants";

/**
 * PUT /api/mobile/driver/trips/[id]/accept
 *
 * Accept or decline a dispatched trip. A driver may only act on trips assigned
 * to them, and only when the trip is in a pre-acceptance state.
 *
 * Body: { accept: true | false }
 *
 * Accepting transitions to "Driver Accepted". Declining transitions to
 * "Cancelled" — trips have no "Rejected" state per the chk_trip_status
 * constraint in 012_status_constraints.sql.
 *
 * The state machine (canTransitionTrip) is the single authority: accept is only
 * legal from Assigned. Legacy ingest statuses (Pending/Approved/…/Dispatched)
 * are bridged through Assigned first, then advance to "Driver Accepted".
 */

export async function PUT(req, { params }) {
  try {
    const session = await requireDriver(req);
    const id = (await params).id;
    const body = await parseBody(req);

    if (typeof body.accept !== "boolean") {
      return err("accept field is required and must be true or false", 400);
    }

    const trip = await assertTripOwnership(session, id);
    const current = trip.trip_status;
    const target = body.accept ? TRIP_STATUS.DRIVER_ACCEPTED : TRIP_STATUS.CANCELLED;

    const check = canTransitionTrip(current, target);
    if (!check.ok) {
      // Accepting from a legacy ingest status: bridge through Assigned first.
      if (body.accept && canTransitionTrip(current, TRIP_STATUS.ASSIGNED).ok) {
        const { rows: bridged } = await query(
          `UPDATE trips SET trip_status = $1, updated_at = NOW() WHERE trip_id = $2 RETURNING *`,
          [TRIP_STATUS.ASSIGNED, id]
        );
        if (!bridged[0]) return err("Trip not found", 404);
      } else {
        return err(
          `Cannot accept or decline a trip with status '${current}'`,
          409
        );
      }
    }

    const { rows } = await query(
      `UPDATE trips
          SET trip_status = $1, updated_at = NOW(), updated_by = $2
        WHERE trip_id = $3
        RETURNING *`,
      [target, session.user.employeeId, id]
    );

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
