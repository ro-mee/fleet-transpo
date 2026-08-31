import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";
import { isValidCoordinate } from "@/lib/gps";

/**
 * POST /api/mobile/driver/trips/[id]/gps
 *
 * Alias for the existing /api/trips/[id]/locations POST. Mobile apps call this
 * route instead — the name is clearer ("gps" not "locations"), and this path
 * lives under the mobile namespace where every route is driver-only by default.
 *
 * Identical behavior: vehicle_id is taken from the trip row, never from the
 * request body. driver_id was dropped in migration 019 (never read; derivable
 * from the trip).
 */
export async function POST(req, { params }) {
  try {
    const session = await requireDriver(req);
    const id = (await params).id;
    const body = await parseBody(req);

    const trip = await assertTripOwnership(session, id);

    // A delayed foreground/background callback may arrive after completion or
    // cancellation. Keep GPS writes inside the same operational window used by
    // the live map so those late samples cannot extend a finished trip.
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

    await query(
      `UPDATE drivers
          SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
        WHERE driver_id = $3`,
      [latitude, longitude, trip.driver_id]
    );

    return ok(rows[0], 201);
  } catch (e) {
    return handleError(e);
  }
}
