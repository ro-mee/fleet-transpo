import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { checkDestinationProximity } from "@/services/trip-geofence.service";

/**
 * GET /api/trips/[id]/destination-check
 *
 * Pre-completion proximity read for the driver app's "Complete Anyway" flow:
 * answers inside / outside / unknown for the trip's destination geofence from
 * the server's own latest GPS ping — never from a client-supplied position.
 * Read-only; changes nothing. The PUT /api/trips/[id]/complete gate below is
 * the enforcing counterpart for direct callers.
 */
export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "read");
    const id = (await params).id;
    await assertTripOwnership(session, id);
    const check = await checkDestinationProximity({ query }, id);
    return ok({
      trip_id: Number(id),
      state: check.state,
      distance_m: check.distanceM,
      radius_m: check.radiusM,
      destination: check.label,
      destination_source: check.source,
      reason: check.reason,
      recorded_at: check.recordedAt,
    });
  } catch (e) { return handleError(e); }
}
