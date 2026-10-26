import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";
import { recordTripGps } from "@/services/trip-gps.service";

export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "read");
    const id = (await params).id;

    // GPS breadcrumbs are a movement history of a named person. A driver may
    // read their own trace; anyone else's is a 404.
    await assertTripOwnership(session, id);

    const { rows } = await query(
      `SELECT * FROM gpstracking WHERE trip_id = $1 ORDER BY recorded_at ASC`,
      [id]
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}

/**
 * Records one GPS sample for a trip.
 *
 * vehicle_id is taken from the trip row, never from the request body — a client
 * that could name its own vehicle_id could write points into another vehicle's
 * history. driver_id was dropped in migration 019: the driver is derivable from
 * the trip, and the column was never read.
 */
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    const body = await parseBody(req);

    const trip = await assertTripOwnership(session, id);

    // Reject late GPS callbacks after a trip leaves the operational window.
    if (!LIVE_TRIP_STATUSES.includes(trip.trip_status)) {
      return ok({ success: true, tracked: false, reason: "trip-not-live" });
    }

    return ok(await recordTripGps(trip, body, query), 201);
  } catch (e) { return handleError(e); }
}
