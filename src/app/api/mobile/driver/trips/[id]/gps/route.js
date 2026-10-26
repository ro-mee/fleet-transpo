import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";
import { recordTripGps } from "@/services/trip-gps.service";

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
 *
 * Persistence and live advisories are shared with the general locations route;
 * auth stays route-specific (driver-only here, permission-checked there).
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

    return ok(await recordTripGps(trip, body, query), 201);
  } catch (e) {
    return handleError(e);
  }
}
