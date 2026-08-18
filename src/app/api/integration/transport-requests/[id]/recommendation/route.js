import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { buildDispatchRecommendation, shapePinnedPair } from "@/lib/ai/dispatch-advisor";
import { NON_DISPATCHABLE_VEHICLE_STATUSES } from "@/lib/ai/pair-scoring";
import { estimateEfficiency, isProximityRelevant } from "@/lib/ai/rule-engine";
import { predictVehicle } from "@/lib/ai/predictive-maintenance";
import { estimateTrip, estimateFuel, resolveCoordinates, haversineKm, HOTEL_BASE } from "@/lib/geo/distance";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { saveRecommendationSnapshot, getActiveRecommendation, validatePairAvailability } from "@/services/recommendation.service";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";

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
  "Ready must include only the most relevant pickup-window, leave, capacity, location, fuel, maintenance, or workload fact. " +
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
 * Proximity is TIME-GATED: the nearest-driver bonus only ranks for immediate
 * dispatch (pickup within PROXIMITY_WINDOW_HRS). A future-dated reservation
 * still shows each driver's distance as information, but no driver earns a
 * proximity ranking bonus. Schedule gap, fuel economy and maintenance risk are
 * always valid because there is a real slot on the future date.
 */
const PROXIMITY_WINDOW_HRS = 3;

/**
 * A usable lat/lng pair, or null when the position is not actually recorded.
 *
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so a NULL coordinate
 * column reads as a perfectly valid position at (0, 0) — roughly 13,300 km from
 * Manila, out in the Gulf of Guinea. Reject the empty cases explicitly, and
 * treat exact (0, 0) as unset: it is never a real position for this fleet.
 */
function toCoords(lat, lng) {
  if (lat === null || lat === undefined || lat === "") return null;
  if (lng === null || lng === undefined || lng === "") return null;

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  if (Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) return null;
  if (latNum === 0 && lngNum === 0) return null;

  return { lat: latNum, lng: lngNum };
}

/**
 * Where a driver is starting from, and how confident we are about it.
 *
 * `basis` travels with the number so the narration can say "assumed at hotel
 * base" instead of presenting a fallback as a tracked position.
 */
function driverPosition(driver, ping) {
  const own = toCoords(driver?.current_latitude, driver?.current_longitude);
  if (own) return { ...own, basis: "recorded position" };

  const gps = toCoords(ping?.latitude, ping?.longitude);
  if (gps) return { ...gps, basis: "last GPS ping" };

  return { ...HOTEL_BASE, basis: "assumed at hotel base" };
}

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

  // Two deliberate widenings of the candidate pools, both so the pair engine can
  // apply the real rule instead of inheriting a wrong verdict from a status column:
  //
  // Vehicles — only statuses that actually ground the vehicle are excluded.
  // `Reserved` is not one of them: it is written whenever the vehicle has a
  // booking on the current day, so filtering on `= 'Available'` dropped cars that
  // are genuinely free at the requested time. `schedule_load` below already
  // answers the time-specific question by overlap, and the engine treats a
  // non-zero load as disqualifying — so overlap, not the label, decides.
  //
  // Drivers — the whole roster, not just `Available` ones. The engine must be
  // able to SEE that a vehicle's custodian is On Leave; if that row is missing it
  // reads the car as having no custodian and reports the wrong reason. Nothing is
  // loosened by this: `isDriverUnavailableFor` re-checks status, licence and
  // window load, and only a designated driver or an explicitly assigned
  // substitute is ever offered.
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
          AND v.vehicle_status <> ALL($5::text[])
          AND (v.seating_capacity IS NULL OR v.seating_capacity >= $1::int)
          AND ($4::int IS NULL OR v.category_id = $4::int)`,
      [
        passengers,
        windowStart,
        windowEnd,
        request?.requested_category_id ?? null,
        NON_DISPATCHABLE_VEHICLE_STATUSES,
      ]
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
              COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days')  AS trips_7d,
              COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days') AS trips_30d,
              COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS km_7d,
              COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS km_30d,
              COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                         FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS hours_7d,
              COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                         FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS hours_30d,
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
        GROUP BY d.driver_id, e.first_name, e.last_name`,
      [windowStart, windowEnd]
    ).then((r) =>
      r.rows.map((d) => {
        const position = driverPosition(d, gpsByDriver.get(d.driver_id));
        d._pickup_distance_km = pickupCoords
          ? Number(haversineKm(pickupCoords, position).toFixed(1))
          : null;
        d._position_basis = position.basis;
        d._proximity_relevant = proximityRelevant;
        d._schedule_load = Number(d.schedule_load) || 0;
        // Rolling workload signals (AI Fair Workload Distribution). Coerce pg's
        // numeric returns so the pure scorer sees plain numbers.
        d._workload_trips_7d = Number(d.trips_7d) || 0;
        d._workload_trips_30d = Number(d.trips_30d) || 0;
        d._workload_km_7d = Number(d.km_7d) || 0;
        d._workload_km_30d = Number(d.km_30d) || 0;
        d._workload_hours_7d = Number(d.hours_7d) || 0;
        d._workload_hours_30d = Number(d.hours_30d) || 0;
        return d;
      })
    ),
  ]);

  return { vehicles, drivers, windowStart, windowEnd };
}

/** Flatten the scorer's output into the facts the model is allowed to talk about. */
function buildRationalePrompt(request, recommendation) {
  const pair = recommendation.pair?.recommended;
  const v = pair?.vehicle ?? recommendation.vehicle?.recommended;
  const d = pair?.driver ?? recommendation.driver?.recommended;
  const trip = recommendation.trip ?? {};
  const risks = [...(v?.detected_risks ?? []), ...(d?.detected_risks ?? [])];

  // Never let a missing value reach the model as a number or a bare "?" — it
  // reads those as facts and repeats them with full confidence. An explicit
  // "not recorded" is something the model can correctly flag as unverified.
  const known = (value, format = (x) => String(x)) =>
    value === null || value === undefined || value === "" ? "not recorded" : format(value);

  // Distance is only a fact when the position behind it is one. An assumed
  // position must never be narrated as "N km away".
  const assumedPosition = d?.position_basis === "assumed at hotel base";
  const distanceLine =
    d?.distance_from_pickup_km == null
      ? "Distance to pickup: not computed (pickup location could not be resolved)."
      : assumedPosition
        ? "Distance to pickup: UNKNOWN — this driver has no recorded position or GPS ping. Do not state a distance or an ETA for them; say their location is unconfirmed and must be verified by radio."
        : `Distance to pickup: ${d.distance_from_pickup_km} km (${d.position_basis}).`;

  const seats = Number(v?.seating_capacity);
  const passengers = Number(trip.passenger_count) || 1;
  const seatLine = Number.isFinite(seats)
    ? seats === passengers
      ? `Seats ${seats} for ${passengers} passenger(s) — exactly at capacity, no spare seat for luggage overflow.`
      : `Seats ${seats} for ${passengers} passenger(s) — ${seats - passengers} spare seat(s).`
    : `Seating capacity not recorded; ${passengers} passenger(s) expected.`;

  const lines = [
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
          `Fuel level: ${known(v.fuel_level, (x) => `${x}%`)}. Estimated burn for this trip: ${known(v.estimated_fuel_liters, (x) => `${x} L`)}.`,
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
async function loadPinnedPair(vehicleId, driverId, request, trip) {
  const [vehicleRow, driverRow] = await Promise.all([
    vehicleId
      ? query(
          `SELECT v.*, vc.category_name
             FROM vehicles v
             LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
            WHERE v.vehicle_id = $1 AND v.deleted_at IS NULL`,
          [vehicleId]
        ).then((r) => r.rows[0] ?? null)
      : null,
    driverId
      ? query(
          `SELECT d.*,
                  e.first_name,
                  e.last_name,
                  ROUND(AVG(t.customer_rating)::numeric, 2) AS avg_guest_rating,
                  COUNT(t.trip_id)::int                     AS total_completed_trips,
                  COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days')  AS trips_7d,
                  COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days') AS trips_30d,
                  COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS km_7d,
                  COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS km_30d,
                  COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                             FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS hours_7d,
                  COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                             FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS hours_30d
             FROM drivers d
             LEFT JOIN employees e ON e.employee_id = d.employee_id
             LEFT JOIN trips t
                    ON t.driver_id = d.driver_id
                   AND t.trip_status = 'Completed'
                   AND t.deleted_at IS NULL
            WHERE d.driver_id = $1 AND d.deleted_at IS NULL
            GROUP BY d.driver_id, e.first_name, e.last_name`,
          [driverId]
        ).then((r) => r.rows[0] ?? null)
      : null,
  ]);

  if (!vehicleRow && !driverRow) return null;

  if (vehicleRow) {
    vehicleRow._est_fuel_liters = estimateFuel(
      trip.distanceKm,
      estimateEfficiency(vehicleRow),
      vehicleRow.tank_capacity ?? null
    ).liters;
    vehicleRow._maintenance = predictVehicle(vehicleRow);
  }

  if (driverRow) {
    const pickupCoords = resolveCoordinates(request?.pickup_location);
    const lastPing = await query(
      `SELECT DISTINCT ON (t.driver_id) g.latitude, g.longitude
         FROM gpstracking g
         JOIN trips t ON t.trip_id = g.trip_id
        WHERE t.driver_id = $1
        ORDER BY t.driver_id, g.recorded_at DESC`,
      [driverId]
    ).then((r) => r.rows[0] ?? null);

    const position = driverPosition(driverRow, lastPing);
    driverRow._pickup_distance_km = pickupCoords
      ? Number(haversineKm(pickupCoords, position).toFixed(1))
      : null;
    driverRow._position_basis = position.basis;
    driverRow._proximity_relevant = isProximityRelevant(
      request?.pickup_datetime,
      new Date(),
      PROXIMITY_WINDOW_HRS
    ) && !!pickupCoords;
  }

  return { vehicle: vehicleRow, driver: driverRow };
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

async function loadActivePairs() {
  const { rows } = await query(
    `SELECT driver_id, vehicle_id
       FROM driver_vehicle_assignments
      WHERE assigned_until IS NULL`
  );
  return rows;
}

/** All substitute coverage rows — the engine resolves which covers the date. */
async function loadActiveSubstitutes() {
  const { rows } = await query(
    `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
       FROM substitute_vehicle_schedules`
  );
  return rows;
}

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

  const trip = estimateTrip(request?.pickup_location, request?.dropoff_location);
  const pinnedRows = await loadPinnedPair(pinnedVehicleId, pinnedDriverId, request, trip);
  if (!pinnedRows) return narrate(request, recommendation, session);

  const scored = recommendation.pair?.recommended;
  const isSamePair =
    scored?.vehicle_id === pinnedVehicleId && scored?.driver_id === pinnedDriverId;

  // The scored pair's score/reasons only describe the scored pair. Carry them
  // over when the pin IS that pair, and drop them otherwise.
  const shaped = shapePinnedPair({
    vehicle: pinnedRows.vehicle,
    driver: pinnedRows.driver,
    request,
    score: isSamePair ? (scored?.score ?? null) : null,
  });

  return narrate(
    request,
    {
      ...recommendation,
      pair: {
        ...recommendation.pair,
        recommended: {
          ...(isSamePair ? scored : {}),
          ...shaped,
          vehicle_id: pinnedVehicleId,
          driver_id: pinnedDriverId,
          is_designated: isSamePair ? scored?.is_designated : undefined,
          replacement_reason: isSamePair ? scored?.replacement_reason : null,
        },
      },
    },
    session
  );
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
        // Revalidate against the LIVE pairing before serving. A stored
        // snapshot can be minutes old; the custodian may have been reassigned
        // or gone on leave since. If the recommended pair no longer holds,
        // discard it and fall through to a fresh computation below — the panel
        // must never display (or let the dispatcher accept) a pair that is no
        // longer backed by the current designated/substitute assignment.
        const rec = pair?.recommended ?? null;
        const recVehicleId = rec?.vehicle?.vehicle_id ?? null;
        const recDriverId = rec?.driver?.driver_id ?? null;
        if (recVehicleId && recDriverId) {
          const revalidated = await validatePairAvailability({
            request,
            vehicleId: recVehicleId,
            driverId: recDriverId,
          });
          if (revalidated.ok) {
            // Legacy read-back compat: expose the stored legacy columns too, if any.
            const legacy = {
              vehicle: request.ai_vehicle_recommendation,
              driver: request.ai_driver_recommendation,
            };
            const narrationResult = await narrateForRequest(
              req,
              request,
              { trip: pair?.trip ?? null, pair: { recommended: rec } },
              session
            );
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
              narration: narrationResult,
            });
          }
          // fall through: the stored pair is stale, regenerate fresh
        }
      }
    }

    const { vehicles, drivers, windowStart, windowEnd } = await fetchCandidates(request);
    const [activePairs, activeSubstitutes] = await Promise.all([
      loadActivePairs(),
      loadActiveSubstitutes(),
    ]);
    const scheduleContext = await loadDriverScheduleContext(drivers.map((d) => d.driver_id));
    const recommendation = buildDispatchRecommendation({
      request,
      vehicles,
      drivers,
      activePairs,
      activeSubstitutes,
      returnAt: windowEnd ? new Date(windowEnd) : null,
      scheduleContext,
    });

    // Only the explicit second call pays for the provider round-trip.
    recommendation.narration = await narrateForRequest(req, request, recommendation, session);

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
    const { vehicles, drivers, windowStart, windowEnd } = await fetchCandidates(request);
    const [activePairs, activeSubstitutes] = await Promise.all([
      loadActivePairs(),
      loadActiveSubstitutes(),
    ]);
    const scheduleContext = await loadDriverScheduleContext(drivers.map((d) => d.driver_id));
    const recommendation = buildDispatchRecommendation({
      request,
      vehicles,
      drivers,
      activePairs,
      activeSubstitutes,
      returnAt: windowEnd ? new Date(windowEnd) : null,
      scheduleContext,
    });

    const pairPayload = {
      trip: recommendation.trip,
      recommended: recommendation.pair?.recommended ?? null,
      alternate: recommendation.pair?.alternate ?? null,
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

    return ok({ ...recommendation, pair: pairPayload, snapshot, request: rows[0] ?? null });
  } catch (e) { return handleError(e); }
}
