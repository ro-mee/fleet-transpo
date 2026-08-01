import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

// Statuses a driver may set from the app. Cancelling or reassigning a trip stays
// an operations decision, so those are not listed here.
const DRIVER_ALLOWED_STATUSES = [
  "Driver Accepted",
  "Trip Started",
  "En Route",
  "Arrived",
  "Completed",
];

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
    const id = (await params).id;
    const body = await parseBody(req);

    // Throws 404 when the trip is not the caller's own.
    await assertTripOwnership(session, id);

    if (!body.status) {
      return err("Status is required", 400);
    }
    if (session.user.role === "driver" && !DRIVER_ALLOWED_STATUSES.includes(body.status)) {
      return err(`Drivers may not set status '${body.status}'`, 403);
    }

    const { rows } = await query(
      `UPDATE trips SET trip_status = $1, updated_at = NOW() WHERE trip_id = $2 RETURNING *`,
      [body.status, id]
    );
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
