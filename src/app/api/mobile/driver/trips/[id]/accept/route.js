import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";

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
 */

const PENDING_STATUSES = [
  "Pending",
  "Approved",
  "Assigned",
  "Vehicle Assigned",
  "Driver Assigned",
  "Dispatched",
];

export async function PUT(req, { params }) {
  try {
    const session = await requireDriver(req);
    const id = (await params).id;
    const body = await parseBody(req);

    if (typeof body.accept !== "boolean") {
      return err("accept field is required and must be true or false", 400);
    }

    const trip = await assertTripOwnership(session, id);

    if (!PENDING_STATUSES.includes(trip.trip_status)) {
      return err(
        `Cannot accept or decline a trip with status '${trip.trip_status}'`,
        409
      );
    }

    const newStatus = body.accept ? "Driver Accepted" : "Cancelled";

    const { rows } = await query(
      `UPDATE trips
          SET trip_status = $1, updated_at = NOW(), updated_by = $2
        WHERE trip_id = $3
        RETURNING *`,
      [newStatus, session.user.employeeId, id]
    );

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
