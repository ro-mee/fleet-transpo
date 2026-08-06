import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";

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

async function fetchCandidates(request) {
  const passengers = Number(request?.passenger_count) || 1;

  const [vehicles, drivers] = await Promise.all([
    query(
      `SELECT v.*, row_to_json(vc.*) AS vehiclecategories
         FROM vehicles v
         LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
        WHERE v.deleted_at IS NULL
          AND v.vehicle_status = 'Available'
          AND (v.seating_capacity IS NULL OR v.seating_capacity >= $1)
          AND ($2::int IS NULL OR v.category_id = $2::int)`,
      [passengers, request?.requested_category_id ?? null]
    ).then((r) => r.rows),

    query(
      `SELECT d.*,
              e.first_name,
              e.last_name,
              ROUND(AVG(t.customer_rating)::numeric, 2)      AS avg_guest_rating,
              ROUND(AVG(t.smooth_driving_score)::numeric, 2) AS avg_driving_score,
              COUNT(t.trip_id)::int                          AS total_completed_trips
         FROM drivers d
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN trips t
                ON t.driver_id = d.driver_id
               AND t.trip_status = 'Completed'
               AND t.deleted_at IS NULL
        WHERE d.deleted_at IS NULL
          AND d.driver_status = 'Available'
        GROUP BY d.driver_id, e.first_name, e.last_name`
    ).then((r) => r.rows),
  ]);

  return { vehicles, drivers };
}

/** Flatten the scorer's output into the facts the model is allowed to talk about. */
function buildRationalePrompt(request, recommendation) {
  const v = recommendation.vehicle?.recommended;
  const d = recommendation.driver?.recommended;
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
      ? `Chosen vehicle: ${v.vehicle_name} (${v.plate_number || "no plate on file"}), seats ${v.seating_capacity ?? "?"}, fuel ${v.fuel_level ?? "?"}%. Score ${v.score}/100. Scorer reasons: ${(v.reasons ?? []).join("; ") || "none recorded"}. Estimated fuel burn: ${v.estimated_fuel_liters ?? "?"} L.`
      : `Chosen vehicle: none — ${recommendation.vehicle?.considered ?? 0} vehicle(s) were available but none fit this request.`,
    d
      ? `Chosen driver: ${d.driver_name}, ${d.years_of_experience ?? "?"} year(s) experience, rating ${d.rating ?? "unrated"}. Score ${d.score}/100. Scorer reasons: ${(d.reasons ?? []).join("; ") || "none recorded"}.`
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

export async function GET(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    const { vehicles, drivers } = await fetchCandidates(request);
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers });

    // Only the explicit second call pays for the provider round-trip.
    if (new URL(req.url).searchParams.get("narrate") === "1") {
      recommendation.narration = await narrate(request, recommendation, session);
    }

    return ok(recommendation);
  } catch (e) { return handleError(e); }
}

export async function POST(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    // No narration here: this call persists the recommendation, and a write path
    // must not wait on an external provider. GET is where the prose belongs.
    const { vehicles, drivers } = await fetchCandidates(request);
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers });

    const { rows } = await query(
      `UPDATE transportation_requests
          SET ai_vehicle_recommendation = $1,
              ai_driver_recommendation = $2,
              estimated_distance = COALESCE(estimated_distance, $3),
              estimated_duration = COALESCE(estimated_duration, $4)
        WHERE request_id = $5
      RETURNING *`,
      [
        JSON.stringify(recommendation.vehicle),
        JSON.stringify(recommendation.driver),
        recommendation.trip.estimated_distance_km,
        recommendation.trip.estimated_travel_minutes,
        id,
      ]
    );

    return ok({ ...recommendation, request: rows[0] ?? null });
  } catch (e) { return handleError(e); }
}
