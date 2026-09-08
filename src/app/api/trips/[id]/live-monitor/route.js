import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { evaluateLiveTripMonitor } from "@/services/live-trip-monitor.service";

/**
 * GET /api/trips/[id]/live-monitor — full live evaluation for ONE trip.
 *
 * This is the expensive-precision counterpart to /api/trips/live-monitor
 * (review correction #4): a fresh traffic-aware ETA leg under the per-trip
 * snapshot policy, planned passenger minutes, next ASSIGNED dispatch impact
 * with reposition routing, and open incidents. Alert transitions are
 * persisted (appear / severity-jump / resolve) with threshold-entry
 * notifications to the dispatcher (and fleet_manager at ACTION).
 *
 * Access: staff via trips read; drivers may read their OWN trip — a foreign
 * trip 404s as nonexistent (assertTripOwnership contract). A trip outside the
 * live lifecycle returns { live: false } with its status, never a fabricated
 * evaluation. Read-only for the trip itself: recommend-only, always.
 */
export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "read");
    const id = (await params).id;
    await assertTripOwnership(session, id);

    const result = await evaluateLiveTripMonitor({ query }, { tripId: Number(id) });
    if (!result) return err("Trip not found", 404);
    return ok(result);
  } catch (e) {
    return handleError(e, { req, operation: "trips.live-monitor-detail" });
  }
}
