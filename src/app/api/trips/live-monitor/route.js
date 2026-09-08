import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { summarizeFleet } from "@/services/live-trip-monitor.service";
import { RISK_LEVELS } from "@/lib/monitoring/live-trip-monitor";

/**
 * GET /api/trips/live-monitor — fleet-wide live operational triage.
 *
 * One cheap summary per in-progress trip: NO fresh TomTom routing, no
 * reposition legs — cached signals and durable alert rows only (review
 * correction #4: fleet overview = cheap triage; the selected-trip endpoint is
 * where expensive precision is spent). Sorted worst-first:
 * ACTION → ATTENTION → UNKNOWN (can't tell / telemetry) → WATCH → NORMAL,
 * then earliest scheduled pickup, then largest projected delay.
 *
 * Read-only and recommend-only: this endpoint never mutates trip state.
 */
export async function GET(req) {
  try {
    await requirePermission(req, "trips", "read_all");
    const now = new Date();
    const { trips } = await summarizeFleet({ query }, { now });

    const counts = {
      [RISK_LEVELS.ACTION]: 0,
      [RISK_LEVELS.ATTENTION]: 0,
      [RISK_LEVELS.UNKNOWN]: 0,
      [RISK_LEVELS.WATCH]: 0,
      [RISK_LEVELS.NORMAL]: 0,
    };
    for (const trip of trips) {
      if (counts[trip.risk] != null) counts[trip.risk] += 1;
    }

    return ok({
      generatedAt: now.toISOString(),
      count: trips.length,
      byRisk: counts,
      trips,
    });
  } catch (e) {
    return handleError(e, { req, operation: "trips.live-monitor" });
  }
}
