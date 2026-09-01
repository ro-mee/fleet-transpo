import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { isValidCoordinate } from "@/lib/gps";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";

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

    if (!isValidCoordinate(body.latitude, body.longitude)) {
      return err("latitude and longitude are required", 400);
    }
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    const toNumberOrNull = (value) => {
      if (value == null || String(value).trim() === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const { rows } = await query(
      `INSERT INTO gpstracking
         (vehicle_id, trip_id, latitude, longitude, speed, heading, altitude, accuracy, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::TIMESTAMPTZ, NOW()))
       RETURNING *`,
      [
        trip.vehicle_id,
        trip.trip_id,
        latitude,
        longitude,
        toNumberOrNull(body.speed),
        toNumberOrNull(body.heading),
        toNumberOrNull(body.altitude),
        toNumberOrNull(body.accuracy),
        body.recorded_at ?? null,
      ]
    );

    // Keep the driver's last-known position current so the live map does not
    // have to scan the full breadcrumb table.
    await query(
      `UPDATE drivers
          SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
        WHERE driver_id = $3`,
      [latitude, longitude, trip.driver_id]
    );

    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
