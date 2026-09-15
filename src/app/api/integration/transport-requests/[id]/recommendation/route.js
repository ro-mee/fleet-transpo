import { prepareDispatchRecommendation } from "@/services/dispatch-recommendation-preparation.service";
import { applyDispatchRadar } from "@/services/dispatch-radar.service";
import { query } from "@/lib/db";
import { requirePermission, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { saveRecommendationSnapshot } from "@/services/recommendation.service";
import { isFuelNoise } from "@/lib/dispatch/decision";

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
  "Write exactly three short plain-text lines starting with 'Fit:', 'Ready:', and 'Check:'. " +
  "Keep each line to 18 words or fewer. Fit must name the selected vehicle and driver plus the strongest matching fact. " +
  "Ready must include only the most relevant pickup-window, leave, capacity, location, maintenance, or workload fact. " +
  "Check must state one warning or confirmation needed before assignment; if none exists, say 'No flagged risk.' " +
  "Do not use checkmarks, bullets, markdown, headings, extra introductions, or recommend a different vehicle or driver. " +
  "Use only the facts given - never invent facts or imply that an unverified value was checked. " +
  "Refer to the vehicle and driver EXACTLY as named in the facts; never substitute a different plate number, vehicle class, or driver name. " +
  "When a value is given as 'not recorded' or 'UNKNOWN', treat it as missing data: say it is unverified and must be confirmed. " +
  "Never restate a missing value as a number, and never describe missing data as if it were a measured result.";

/**
 * Fetch the candidate pools and attach the Smart Dispatch signals as
 * `_`-prefixed attributes on each row. The rule-engine scorers stay pure; this
 * is where the I/O and the derived numbers (proximity, fuel, schedule load,
 * maintenance risk) are computed once and passed in.
 *
 * No current location is loaded in this preparation step. Per-pair context,
 * qualified standby evidence and routed feasibility are evaluated afterward,
 * before the final recommendation is selected.
 */


/** Flatten the scorer's output into the facts the model is allowed to talk about. */
function buildRationalePrompt(request, recommendation) {
  const pair = recommendation.pair?.recommended;
  const v = pair?.vehicle ?? recommendation.vehicle?.recommended;
  const d = pair?.driver ?? recommendation.driver?.recommended;
  const trip = recommendation.trip ?? {};
  // Fuel findings are engine records, never narration material.
  const risks = [...(v?.detected_risks ?? []), ...(d?.detected_risks ?? [])].filter((r) => !isFuelNoise(r?.message));

  // Never let a missing value reach the model as a number or a bare "?" — it
  // reads those as facts and repeats them with full confidence. An explicit
  // "not recorded" is something the model can correctly flag as unverified.
  const known = (value, format = (x) => String(x)) =>
    value === null || value === undefined || value === "" ? "not recorded" : format(value);

  // Distance is only a fact when the position behind it is one. An assumed
  // position must never be narrated as "N km away".
  const distanceLine = pair?.dispatchContext?.mode === 'SCHEDULED'
    ? 'Scheduled planning. Current location is excluded.'
    : pair?.proximity ? 'Verified routed pickup ETA: ' + pair.proximity.etaMinutes + ' minutes (' + pair.proximity.source + ').'
    : pair?.dispatchContext?.mode === 'REPOSITION' ? 'Expected origin: ' + (pair.dispatchContext.originLabel || 'unverified')
    : 'Pickup readiness is unverified. No measured ETA.';

  const seats = Number(v?.seating_capacity);
  const passengers = Number(trip.passenger_count) || 1;
  const seatLine = Number.isFinite(seats)
    ? seats === passengers
      ? `Seats ${seats} for ${passengers} passenger(s) — exactly at capacity, no spare seat for luggage overflow.`
      : `Seats ${seats} for ${passengers} passenger(s) — ${seats - passengers} spare seat(s).`
    : `Seating capacity not recorded; ${passengers} passenger(s) expected.`;

  const lines = [
    `Dispatch context: ${pair?.dispatchContext?.mode ?? 'Unverified'}. Readiness: ${pair?.readiness ?? 'REVIEW_REQUIRED'}. Feasibility: ${pair?.feasibility?.verdict ?? 'UNKNOWN'}. ${(pair?.feasibility?.reasons ?? []).join(' ')}`,
    `Guest: ${request?.guest_name || "Walk-in guest"} · ${passengers} passenger(s)`,
    `Route: ${request?.pickup_location || "unspecified"} to ${request?.dropoff_location || "unspecified"}`,
    `Pickup: ${request?.pickup_datetime || "unscheduled"} · Priority: ${request?.priority || "Medium"}`,
    `Requested class: ${request?.requested_vehicle_type || "unspecified"}`,
    trip.estimated_distance_km != null
      ? `Trip estimate: ${trip.estimated_distance_km} km, about ${trip.estimated_travel_minutes} minutes (${trip.estimate_basis} estimate, ${trip.estimate_confidence} confidence).`
      : "Trip estimate: unavailable.",
    "",
    v
      ? [
          `Chosen vehicle: ${known(v.vehicle_name)} (plate ${known(v.plate_number)}).`,
          seatLine,
          `Pair score ${known(pair?.score ?? v.score, (x) => `${x}/100`)}. Scorer reasons: ${(pair?.reasons ?? v.reasons ?? []).join("; ") || "none recorded"}.`,
          `Scheduled dispatches in this window: ${known(v.schedule_load)}. Service risk: ${known(v.maintenance?.risk)}.`,
        ].join(" ")
      : `Chosen vehicle: none — ${recommendation.vehicle?.considered ?? 0} vehicle(s) were available but none fit this request.`,
    d
      ? [
          `Chosen driver: ${known(d.driver_name)}.`,
          `Experience: ${known(d.years_of_experience, (x) => `${x} year(s)`)}.`,
          `Guest rating: ${known(d.rating, (x) => `${x}/5`)} — "not recorded" means this driver has no completed rated trips yet, NOT a poor rating.`,
          distanceLine,
          `Pair score ${known(pair?.score ?? d.score, (x) => `${x}/100`)}. Scorer reasons: ${(pair?.reasons ?? d.reasons ?? []).join("; ") || "none recorded"}.`,
          `Scheduled dispatches in this window: ${known(d.schedule_load)}.`,
          pair?.is_designated
            ? "This is the vehicle's designated driver."
            : pair?.replacement_reason
              ? `Substitute driver because: ${pair.replacement_reason}`
              : "",
        ]
          .filter(Boolean)
          .join(" ")
      : `Chosen driver: none — ${recommendation.driver?.considered ?? 0} driver(s) were available but none qualified.`,
    "",
    risks.length
      ? `Flagged risks: ${risks.map((r) => `[${r.level}] ${r.message}`).join(" ")}`
      : "Flagged risks: none detected.",
  ];

  return lines.join("\n");
}

/**
 * Load the exact vehicle/driver the client pinned, shaped like the advisor's
 * own candidates so buildRationalePrompt() can consume either.
 *
 * The review dialog assembles its "Best Available Pair" from the DB-backed
 * custodial pairings and is what "Approve & Assign Now" commits, while the pair
 * engine ranks its own candidate pool by score. The two can legitimately choose
 * differently, and a checklist about a pair the dispatcher is NOT assigning is
 * worse than no checklist. So the caller pins the pair it is showing and the
 * narration follows it.
 *
 * Returns null halves when an id is absent or no longer matches a live row —
 * the caller then falls back to the scored pair.
 */
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
    max_tokens: 256,
    defer_log: true,
    prefer_fast_model: true,
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



/** All substitute coverage rows — the engine resolves which covers the date. */


/**
 * Narrate a recommendation, honouring a `?vehicle_id=&driver_id=` pin.
 *
 * With a pin, the checklist describes the pair the caller is showing and about
 * to assign. Without one, it falls back to the scored pair — the previous
 * behaviour, still correct for callers that render the scorer's pick directly.
 */
async function narrateForRequest(req, request, recommendation, session) {
  const url = new URL(req.url, `http://${req.headers.get("host") || "localhost"}`);
  if (url.searchParams.get("narrate") !== "1") return null;

  const pinnedVehicleId = Number(url.searchParams.get("vehicle_id")) || null;
  const pinnedDriverId = Number(url.searchParams.get("driver_id")) || null;

  if (!pinnedVehicleId && !pinnedDriverId) {
    return narrate(request, recommendation, session);
  }

  const pinned = recommendation.pair?.candidates?.find(pair => pair.vehicle_id === pinnedVehicleId && pair.driver_id === pinnedDriverId);
  if (!pinned) return null;
  return narrate(request, { ...recommendation, pair: { ...recommendation.pair, recommended: pinned } }, session);
}



/**
 * GET returns the current advisory.
 *
 * Every read re-evaluates current evidence. Stored snapshots are audit records,
 * not permission to reuse an old GPS fix. POST persists the evaluated result.
 */
export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, "reservations", "read");
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    // Snapshots are audit records; every read re-evaluates current evidence and context.
    const { request: recommendationRequest, estimate, drivers, recommendation } = await prepareDispatchRecommendation(request);

    // PR #2: per-pair route feasibility (recommended + alternate + top-3).
    // Advisory information only — scoring is untouched. Fail-open per pair.
    await applyDispatchRadar({
      request: recommendationRequest,
      estimate,
      recommendation,
      drivers,
    });

    // Only the explicit second call pays for the provider round-trip.
    recommendation.narration = await narrateForRequest(req, recommendationRequest, recommendation, session);

    return Response.json(recommendation, { headers: { 'Cache-Control': 'private, no-store' } });
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
    const session = await requirePermission(req, "reservations", "recommend");
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    // No narration here: this call persists the recommendation, and a write path
    // must not wait on an external provider. GET is where the prose belongs.
    const { request: recommendationRequest, estimate, drivers, recommendation } = await prepareDispatchRecommendation(request, { persistRoute: true });

    // Same feasibility attachment as GET, so the persisted snapshot carries
    // exactly what the dispatcher saw (thesis: acceptance vs outcome).
    await applyDispatchRadar({
      request: recommendationRequest,
      estimate,
      recommendation,
      drivers,
    });

    const pairPayload = {
      trip: recommendation.trip,
      recommended: recommendation.pair?.recommended ?? null,
      alternate: recommendation.pair?.alternate ?? null,
      candidates: recommendation.pair?.candidates ?? [],
    };
    const snapshot = await saveRecommendationSnapshot({
      request,
      pair: pairPayload,
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

    return Response.json({ ...recommendation, pair: pairPayload, snapshot }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return handleError(e); }
}
