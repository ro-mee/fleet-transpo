import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { writeAudit } from "@/lib/audit";
import { assertTripOwnership } from "@/lib/api/ownership";
import { completeTrip, cancelTrip, syncBusyTrip } from "@/services/trip-lifecycle.service";
import { TRIP_STATUS } from "@/lib/constants";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"];

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
    const next = body.status;

    if (!next) {
      return err("A status is required.", 400);
    }

    // Throws 404 when the trip is not the caller's own.
    await assertTripOwnership(session, id);

    if (session.user.role === "driver" && !DRIVER_ALLOWED_STATUSES.includes(next)) {
      return err(`Drivers may not set status '${next}'`, 403);
    }

    const { rows: before } = await query(
      `SELECT trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
      [id]
    );
    if (!before[0]) return err("Trip not found", 404);

    const check = canTransitionTrip(before[0].trip_status, next);
    if (!check.ok) return err(check.reason, 409);

    if (next === TRIP_STATUS.COMPLETED) {
      return ok(await completeTrip(id, session, {
        endOdometer: body.end_odometer,
        distance: body.distance,
        startOdometer: body.start_odometer,
      }));
    }
    if (next === TRIP_STATUS.CANCELLED) {
      return ok(await cancelTrip(id, session, { reason: body.reason }));
    }
    if (["Trip Started", "En Route", "Arrived", "In Progress"].includes(next)) {
      await syncBusyTrip(id, session);
    }

    const { rows } = await query(
      `UPDATE trips SET trip_status = $1, updated_at = NOW() WHERE trip_id = $2 RETURNING *`,
      [next, id]
    );
    if (!rows[0]) return err("Trip not found", 404);

    await writeAudit(req, session, {
      action: "update",
      resource: "trips",
      resourceId: id,
      oldValues: { trip_status: before[0].trip_status },
      newValues: { trip_status: next },
    });

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
