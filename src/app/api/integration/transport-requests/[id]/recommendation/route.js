import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";
import { estimateEfficiency, isProximityRelevant } from "@/lib/ai/rule-engine";
import { predictVehicle } from "@/lib/ai/predictive-maintenance";
import { estimateTrip, estimateFuel, resolveCoordinates, haversineKm, HOTEL_BASE } from "@/lib/geo/distance";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { saveRecommendationSnapshot, getActiveRecommendation } from "@/services/recommendation.service";

// Dispatch recommendation — the advisory panel behind the review dialog.
//
// The scoring is deterministic (lib/ai/dispatch-advisor.js): the rule engine
// picks the candidate and every number traces to a rule.
//
// GET returns that scored payload immediately, with `narration: null`.
// GET ?narrate=1 is a SEPARATE, slower call that asks the configured LLM
// provider to write a human-readable rationale for a pick already made.
//
// They are split deliberately. The provider observably takes ~10s and returns
// 529 under load; folding that into the main GET would stall the entire panel
// behind prose nobody needs in order to act. The dispatcher gets the scored
// pairing at once, and the rationale fills in behind it — or never, which is a
// normal outcome and costs nothing.
//
// The narration never changes which vehicle or driver is recommended.
const NARRATION_BUDGET_MS = 25000;

const RATIONALE_INSTRUCTIONS =
  "You are a fleet dispatch assistant for a hotel transportation desk. " +
  "You are given a transport request and the pairing a deterministic scorer already chose. " +
  "Write 2-3 plain sentences explaining why the pairing fits and what the dispatcher should " +
  "double-check before approving. Use only the facts given — never invent vehicles, drivers, " +
  "names, or numbers. Do not recommend a different vehicle or driver. No preamble, no markdown, " +
  "no bullet points.";

/**
 * Fetch the candidate pools and attach the Smart Dispatch signals as
 * `_`-prefixed attributes on each row. The rule-engine scorers stay pure; this
 * is where the I/O and the derived numbers (proximity, fuel, schedule load,
 * maintenance risk) are computed once and passed in.
 *
 * Proximity is TIME-GATED: the nearest-driver bonus only ranks for immediate
 * dispatch (pickup within PROXIMITY_WINDOW_HRS). A future-dated reservation
 * still shows each driver's distance as information, but no driver earns a
 * proximity ranking bonus. Schedule gap, fuel economy and maintenance risk are
 * always valid because there is a real slot on the future date.
 */
const PROXIMITY_WINDOW_HRS = 3;

async function fetchCandidates(request) {
  const passengers = Number(request?.passenger_count) || 1;

  // Same trip estimate the advisor uses, so fuel burn and schedule windows agree.
  const trip = estimateTrip(request?.pickup_location, request?.dropoff_location);
  const windowStart = request?.pickup_datetime ? new Date(request.pickup_datetime).toISOString() : null;
  const windowEnd = windowStart
    ? new Date(new Date(windowStart).getTime() + (trip.durationMin || 60) * 60 * 1000).toISOString()
    : null;

  const pickupCoords = resolveCoordinates(request?.pickup_location);
  const proximityRelevant =
    isProximityRelevant(request?.pickup_datetime, new Date(), PROXIMITY_WINDOW_HRS) && !!pickupCoords;

  // Last known GPS position per driver, as the fallback when current_* is stale/empty.
  const lastGps = await query(
    `SELECT DISTINCT ON (t.driver_id) t.driver_id, g.latitude, g.longitude
       FROM gpstracking g
       JOIN trips t ON t.trip_id = g.trip_id
      WHERE t.driver_id IS NOT NULL
      ORDER BY t.driver_id, g.recorded_at DESC`
  ).then((r) => r.rows);
  const gpsByDriver = new Map(lastGps.map((r) => [r.driver_id, r]));

  const [vehicles, drivers] = await Promise.all([
    query(
      `WITH usage AS (
           SELECT vehicle_id,
                  SUM(distance)                   AS km_90d,
                  COUNT(*)                        AS trip_count,
                  COUNT(DISTINCT DATE(end_time))  AS active_days
             FROM trips
            WHERE trip_status = 'Completed' AND deleted_at IS NULL
              AND end_time > NOW() - INTERVAL '90 days'
            GROUP BY vehicle_id
       ),
       history AS (
           SELECT vehicle_id,
                  COUNT(*) FILTER (WHERE maintenance_type IS DISTINCT FROM 'Routine') AS corrective_count,
                  COUNT(*)                                                             AS total_count
             FROM vehiclemaintenance
            WHERE deleted_at IS NULL AND status = 'Completed'
              AND maintenance_date > NOW() - INTERVAL '365 days'
            GROUP BY vehicle_id
       )
       SELECT v.*, row_to_json(vc.*) AS vehiclecategories,
              u.km_90d, u.trip_count, u.active_days,
              h.corrective_count, h.total_count,
              COALESCE((
                SELECT COUNT(*)
                  FROM dispatchschedules ds
                 WHERE ds.vehicle_id = v.vehicle_id
                   AND ds.deleted_at IS NULL
                   AND ds.status IN ('Scheduled', 'In Progress')
                   AND ($3::timestamptz IS NULL OR ds.scheduled_departure < $3)
                   AND ($2::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $2)
              ), 0)::int AS schedule_load
         FROM vehicles v
         LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
         LEFT JOIN usage   u ON u.vehicle_id = v.vehicle_id
         LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
        WHERE v.deleted_at IS NULL
          AND v.vehicle_status = 'Available'
          AND (v.seating_capacity IS NULL OR v.seating_capacity >= $1::int)
          AND ($4::int IS NULL OR v.category_id = $4::int)`,
      [passengers, windowStart, windowEnd, request?.requested_category_id ?? null]
    ).then((r) =>
      r.rows.map((v) => {
        v._est_fuel_liters = estimateFuel(trip.distanceKm, estimateEfficiency(v), v.tank_capacity ?? null).liters;
        v._schedule_load = Number(v.schedule_load) || 0;
        v._maintenance = predictVehicle(v);
        return v;
      })
    ),

    query(
      `SELECT d.*,
              e.first_name,
              e.last_name,
              ROUND(AVG(t.customer_rating)::numeric, 2)      AS avg_guest_rating,
              ROUND(AVG(t.smooth_driving_score)::numeric, 2) AS avg_driving_score,
              COUNT(t.trip_id)::int                          AS total_completed_trips,
              COALESCE((
                SELECT COUNT(*)
                  FROM dispatchschedules ds
                 WHERE ds.driver_id = d.driver_id
                   AND ds.deleted_at IS NULL
                   AND ds.status IN ('Scheduled', 'In Progress')
                   AND ($2::timestamptz IS NULL OR ds.scheduled_departure < $2)
                   AND ($1::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1)
              ), 0)::int AS schedule_load
         FROM drivers d
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN trips t
                ON t.driver_id = d.driver_id
               AND t.trip_status = 'Completed'
               AND t.deleted_at IS NULL
        WHERE d.deleted_at IS NULL
          AND d.driver_status = 'Available'
        GROUP BY d.driver_id, e.first_name, e.last_name`,
      [windowStart, windowEnd]
    ).then((r) =>
      r.rows.map((d) => {
        let lat = Number(d.current_latitude);
        let lng = Number(d.current_longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const g = gpsByDriver.get(d.driver_id);
          if (g && Number.isFinite(Number(g.latitude))) {
            lat = Number(g.latitude);
            lng = Number(g.longitude);
          } else {
            lat = HOTEL_BASE.lat;
            lng = HOTEL_BASE.lng;
          }
        }
        d._pickup_distance_km = pickupCoords ? Number(haversineKm(pickupCoords, { lat, lng }).toFixed(1)) : null;
        d._proximity_relevant = proximityRelevant;
        d._schedule_load = Number(d.schedule_load) || 0;
        return d;
      })
    ),
  ]);

  return { vehicles, drivers };
}

/** Flatten the scorer's output into the facts the model is allowed to talk about. */
function buildRationalePrompt(request, recommendation) {
  const pair = recommendation.pair?.recommended;
  const v = pair?.vehicle ?? recommendation.vehicle?.recommended;
  const d = pair?.driver ?? recommendation.driver?.recommended;
  const trip = recommendation.trip ?? {};
  const risks = [...(v?.detected_risks ?? []), ...(d?.detected_risks ?? [])];

  const lines = [
    `Guest: ${request?.guest_name || "Walk-in guest"} · ${trip.passenger_count ?? 1} passenger(s)`,
    `Route: ${request?.pickup_location || "unspecified"} to ${request?.dropoff_location || "unspecified"}`,
    `Pickup: ${request?.pickup_datetime || "unscheduled"} · Priority: ${request?.priority || "Medium"}`,
    `Requested class: ${request?.requested_vehicle_type || "unspecified"}`,
    trip.estimated_distance_km != null
      ? `Trip estimate: ${trip.estimated_distance_km} km, about ${trip.estimated_travel_minutes} minutes (${trip.estimate_basis} estimate, ${trip.estimate_confidence} confidence).`
      : "Trip estimate: unavailable.",
    "",
    v
      ? `Chosen vehicle: ${v.vehicle_name} (${v.plate_number || "no plate on file"}), seats ${v.seating_capacity ?? "?"}, fuel ${v.fuel_level ?? "?"}%. Pair score ${pair?.score ?? v.score}/100. Scorer reasons: ${(pair?.reasons ?? v.reasons ?? []).join("; ") || "none recorded"}. Estimated fuel burn: ${v.estimated_fuel_liters ?? "?"} L. ${v.schedule_load ?? 0} scheduled dispatch(es) in this window. Service risk: ${v.maintenance?.risk ?? "not set"}.`
      : `Chosen vehicle: none — ${recommendation.vehicle?.considered ?? 0} vehicle(s) were available but none fit this request.`,
    d
      ? `Chosen driver: ${d.driver_name}, ${d.years_of_experience ?? "?"} year(s) experience, rating ${d.rating ?? "unrated"}. Pair score ${pair?.score ?? d.score}/100. Scorer reasons: ${(pair?.reasons ?? d.reasons ?? []).join("; ") || "none recorded"}. ${d.distance_from_pickup_km != null ? `${d.distance_from_pickup_km} km from pickup.` : "Distance to pickup unknown."} ${d.schedule_load ?? 0} scheduled dispatch(es) in this window. ${pair?.is_designated ? "This is the vehicle's designated driver." : pair?.replacement_reason ? `Substitute because: ${pair.replacement_reason}` : ""}`
      : `Chosen driver: none — ${recommendation.driver?.considered ?? 0} driver(s) were available but none qualified.`,
    "",
    risks.length
      ? `Flagged risks: ${risks.map((r) => `[${r.level}] ${r.message}`).join(" ")}`
      : "Flagged risks: none detected.",
  ];

  return lines.join("\n");
}

/**
 * Ask the provider for a rationale, bounded by NARRATION_BUDGET_MS.
 * Returns null on timeout, provider failure, or no configured provider —
 * every one of which is a normal outcome, not an error.
 */
async function narrate(request, recommendation, session) {
  const call = executeLlmCompletion({
    feature_used: "Dispatch Recommendation Rationale",
    user_prompt: buildRationalePrompt(request, recommendation),
    system_instructions: RATIONALE_INSTRUCTIONS,
    user_email: session?.user?.email || null,
  }).catch(() => null);

  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NARRATION_BUDGET_MS);
  });

  try {
    const result = await Promise.race([call, budget]);
    if (!result?.success || !result.content) return null;
    return {
      text: String(result.content).trim(),
      provider: result.provider ?? null,
      generated_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadActivePairs() {
  const { rows } = await query(
    `SELECT driver_id, vehicle_id
       FROM driver_vehicle_assignments
      WHERE assigned_until IS NULL`
  );
  return rows;
}

/**
 * GET returns the current advisory.
 *
 * If a snapshot exists on disk, that pair is returned verbatim (stable, and the
 * panel can show its expiry/regenerate affordance). If `?regenerate=1` is set,
 * or no snapshot exists yet, a fresh pair is computed and returned — it is only
 * PERSISTED by an explicit POST. GET is always read-only.
 */
export async function GET(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    const regenerate = new URL(req.url).searchParams.get("regenerate") === "1";
    if (!regenerate) {
      const { snapshot, expired, reason } = await getActiveRecommendation(id);
      if (snapshot) {
        const pair = snapshot.pair_json ? JSON.parse(snapshot.pair_json) : null;
        // Legacy read-back compat: expose the stored legacy columns too, if any.
        const legacy = {
          vehicle: request.ai_vehicle_recommendation,
          driver: request.ai_driver_recommendation,
        };
        return ok({
          generated_at: snapshot.generated_at,
          trip: pair?.trip ?? null,
          pair,
          snapshot: {
            snapshot_id: snapshot.snapshot_id,
            valid_until: snapshot.valid_until,
            expired,
            expiry_reason: reason,
            is_consumed: snapshot.is_consumed,
          },
          vehicle: legacy.vehicle,
          driver: legacy.driver,
          narration: null,
        });
      }
    }

    const { vehicles, drivers } = await fetchCandidates(request);
    const activePairs = await loadActivePairs();
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers, activePairs });

    // Only the explicit second call pays for the provider round-trip.
    if (new URL(req.url).searchParams.get("narrate") === "1") {
      recommendation.narration = await narrate(request, recommendation, session);
    }

    return ok(recommendation);
  } catch (e) { return handleError(e); }
}

/**
 * POST generates and PERSISTS a recommendation snapshot (migration 027),
 * back-writing the legacy JSONB columns for consumers that still read them.
 * Returns the new snapshot alongside the pair payload. Generation is idempotent
 * on the pair math; a fresh snapshot row is written each call.
 */
export async function POST(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    // No narration here: this call persists the recommendation, and a write path
    // must not wait on an external provider. GET is where the prose belongs.
    const { vehicles, drivers } = await fetchCandidates(request);
    const activePairs = await loadActivePairs();
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers, activePairs });

    const pairPayload = {
      trip: recommendation.trip,
      recommended: recommendation.pair?.recommended ?? null,
      alternate: recommendation.pair?.alternate ?? null,
    };
    const snapshot = await saveRecommendationSnapshot({
      request,
      pair: {
        trip: recommendation.trip,
        vehicle: recommendation.pair?.recommended?.vehicle ?? null,
        driver: recommendation.pair?.recommended?.driver ?? null,
        designated: recommendation.pair?.recommended
          ? {
              driver_id: recommendation.pair.recommended.designated_driver_id,
            }
          : null,
        score: recommendation.pair?.recommended?.score ?? null,
        confidence: recommendation.pair?.recommended?.confidence ?? null,
        reasons: recommendation.pair?.recommended?.reasons ?? [],
        reason_type: recommendation.pair?.recommended?.reason_type ?? "designated",
        replacement_reason: recommendation.pair?.recommended?.replacement_reason ?? null,
        is_designated: recommendation.pair?.recommended?.is_designated ?? true,
      },
      session,
    });

    const { rows } = await query(
      `UPDATE transportation_requests
          SET estimated_distance = COALESCE(estimated_distance, $1),
              estimated_duration = COALESCE(estimated_duration, $2)
        WHERE request_id = $3
      RETURNING *`,
      [recommendation.trip.estimated_distance_km, recommendation.trip.estimated_travel_minutes, id]
    );

    return ok({ ...recommendation, pair: pairPayload, snapshot, request: rows[0] ?? null });
  } catch (e) { return handleError(e); }
}
