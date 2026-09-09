// Shared post-write enrichment for the two GPS ingest POST handlers:
// /api/mobile/driver/trips/[id]/gps (driver-only) and /api/trips/[id]/locations
// (permission-checked). Their auth/validation differs on purpose and stays in
// each route; what they share is everything AFTER the gpstracking insert and
// drivers.current_* update — the advisory payload block (geofence, monitor,
// weather) that the response carries back to the mobile poster.
//
// Every piece here is best-effort: enrichment describes the ping that was
// already stored, so a failure in any of it must never fail the GPS write.
import { evaluatePingGeofence } from "@/services/trip-geofence.service";
import { evaluatePingMonitor } from "@/services/live-trip-monitor.service";
import { getCurrentConditions } from "@/lib/weather";

/**
 * Build the advisory payload for a just-stored GPS ping.
 *
 * @param {object} trip   the loaded trip row (vehicle_id, trip_id, driver_id used)
 * @param {{latitude: number, longitude: number, accuracy: number|null}} fix
 * @param {typeof query} query  the repo's pg query function (same style the
 *   route handlers already pass to the geofence/monitor services)
 */
export async function buildPingAdvisories(trip, fix, query) {
  // PR #3 arrival intelligence: describe this ping against the trip's
  // pickup/destination geofences. Advisory only — the client turns near_*
  // into a human-confirmed suggestion; nothing here transitions status.
  const geofence = await evaluatePingGeofence({ query }, trip, fix);

  // PR #4 ingest-side monitor: lightweight contextual evaluation for the
  // driver's banner (off-route, traffic delay when already cached).
  let monitor = null;
  try {
    monitor = await evaluatePingMonitor({ query }, { tripId: trip.trip_id });
  } catch {
    monitor = null;
  }

  // Weather chip (2026-09-09): current conditions + place label at the fix's
  // coordinates — ambient context only, never an alert. Coarse-grid cached
  // and ~2 s-capped so it cannot materially delay this response; null on any
  // failure.
  let weather = null;
  try {
    weather = await getCurrentConditions(fix.latitude, fix.longitude);
  } catch {
    weather = null;
  }

  return { geofence, monitor, weather };
}
