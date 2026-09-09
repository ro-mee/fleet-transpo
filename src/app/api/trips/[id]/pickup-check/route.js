import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { checkPickupProximity } from "@/services/trip-geofence.service";

/**
 * GET /api/trips/[id]/pickup-check
 *
 * Pre-arrival proximity read for the driver app's arrival flows ("Proceed
 * Anyway" with a reason): answers inside / outside / unknown for the trip's
 * pickup geofence from the server's own latest GPS ping — never from a
 * client-supplied position. Read-only; changes nothing. The arrival gates in
 * setTripStatus (PUT at-pickup / onboard) are the enforcing counterparts for
 * direct callers.
 */
export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "read");
    const id = (await params).id;
    await assertTripOwnership(session, id);
    const check = await checkPickupProximity({ query }, id);
    return ok({
      trip_id: Number(id),
      state: check.state,
      distance_m: check.distanceM,
      radius_m: check.radiusM,
      pickup: check.label,
      pickup_source: check.source,
      reason: check.reason,
      recorded_at: check.recordedAt,
    });
  } catch (e) { return handleError(e); }
}
