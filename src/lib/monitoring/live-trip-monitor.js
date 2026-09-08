// Live trip monitor — PURE evaluation, no DB, no network, no TomTom.
//
// Answers, for an in-progress trip, one deterministic question set:
//   • on time ba?        → targetDelayMin against the truthful baseline
//   • male-late ba?      → liveEta + trafficDelayMinutes from the caller's
//                          routing signal (live/cached/fallback provenance)
//   • nalilihis ba?      → offRouteState from the off-route engine
//   • okay ba GPS?       → gpsHealth (src/lib/gps.js classification)
//   • maaabot pa ba ang susunod na assigned trip? → nextTrip.slackMin
//
// and condenses them into ONE risk level:
//   NORMAL < WATCH < ATTENTION < ACTION, plus UNKNOWN.
//
// Honesty rules (locked, same family as route-feasibility):
// - A missing signal yields UNKNOWN, never a fabricated number. Stale GPS →
//   ETA unknown — an old value is never presented as live.
// - UNKNOWN never downgrades to NORMAL: "I can't tell" is not "all good".
// - The next trip is the next ASSIGNED dispatch ONLY. Pending queue requests,
//   unassigned bookings, and hypothetical reassignments are PR #5 territory.
// - This engine RECOMMENDS; it never mutates trip status or assignments.
//
// The I/O (trip row, latest GPS pings, TomTom routing, next-dispatch lookup,
// open incidents) lives in src/services/live-trip-monitor.service.js, which
// shapes the input object consumed here.

export const RISK_LEVELS = {
  NORMAL: "NORMAL",
  WATCH: "WATCH",
  ATTENTION: "ATTENTION",
  ACTION: "ACTION",
  UNKNOWN: "UNKNOWN",
};

/** Delay thresholds in minutes (operational tuning, deliberately constants). */
export const WATCH_DELAY_MIN = 5;
export const ATTENTION_DELAY_MIN = 10;
export const ACTION_DELAY_MIN = 15;
/** Slack below which the next assigned trip is at risk (minutes). */
export const TURNAROUND_SAFETY_MIN = 10;

const SEVERITY_RANK = {
  NORMAL: 0,
  UNKNOWN: 1, // "can't tell" sorts above NORMAL but below WATCH
  WATCH: 2,
  ATTENTION: 3,
  ACTION: 4,
};

function toMs(value) {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function minutesBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) return null;
  return (toMs - fromMs) / 60000;
}

/**
 * Risk implied by a projected delay in minutes (null = unknown, no claim).
 * @returns {"NORMAL"|"WATCH"|"ATTENTION"|"ACTION"|null}
 */
function delayRisk(delayMin) {
  if (delayMin == null || !Number.isFinite(delayMin)) return null;
  if (delayMin >= ACTION_DELAY_MIN) return RISK_LEVELS.ACTION;
  if (delayMin >= ATTENTION_DELAY_MIN) return RISK_LEVELS.ATTENTION;
  if (delayMin >= WATCH_DELAY_MIN) return RISK_LEVELS.WATCH;
  return RISK_LEVELS.NORMAL;
}

/**
 * The one-line impact sentence for the next assigned trip. Specific numbers,
 * never a vague "Scheduling conflict detected."
 */
function nextTripImpactSentence({ slackMin, projectedDelayMin }) {
  if (slackMin == null) return null;
  if (slackMin < 0) {
    const late = Math.round(Math.abs(slackMin));
    return `Projected to reach the next assigned pickup about ${late} minute${late === 1 ? "" : "s"} late.`;
  }
  if (slackMin < TURNAROUND_SAFETY_MIN) {
    return `Only ${Math.round(slackMin)} min of turnaround slack before the next assigned pickup.`;
  }
  return `Comfortable — about ${Math.round(slackMin)} min of slack before the next assigned pickup.`;
}

/**
 * Pure evaluation of one trip's live operational risk.
 *
 * @param {object} p
 * @param {Date|string|number} p.now
 * @param {"to_pickup"|"to_destination"|null} p.tripPhase        from resolveTripPhase()
 * @param {"fresh"|"delayed"|"stale"|"no-signal"|null} p.gpsHealth
 * @param {number|null} [p.gpsAccuracyM]
 * @param {Date|string|null} [p.scheduledPickupAt]               truthful baseline or null
 * @param {Date|string|null} [p.scheduledArrivalAt]              truthful baseline or null
 * @param {number|null} [p.liveTargetMinutes]                    GPS → active target travel minutes
 * @param {number|null} [p.trafficDelayMinutes]                  live traffic component of that leg
 * @param {number|null} [p.plannedPassengerMinutes]              planned pickup → destination minutes
 * @param {"on_route"|"off_route"|"unknown"|null} [p.offRouteState]
 * @param {number|null} [p.offRouteDistanceM]
 * @param {Date|string|null} [p.nextAssignedPickupAt]
 * @param {number|null} [p.repositionMinutes]                    destination → next pickup travel minutes
 * @param {null|{severity:string,incident_type:string,incident_id:number}} [p.openIncident]
 * @returns {{risk, activeTarget, liveEta, targetDelayMin, trafficDelayMin, offRoute, nextTrip, gps, reasons, suggestedActions}}
 */
export function evaluateLiveTripMonitor({
  now,
  tripPhase,
  gpsHealth,
  gpsAccuracyM = null,
  scheduledPickupAt = null,
  scheduledArrivalAt = null,
  liveTargetMinutes = null,
  trafficDelayMinutes = null,
  plannedPassengerMinutes = null,
  offRouteState = null,
  offRouteDistanceM = null,
  nextAssignedPickupAt = null,
  repositionMinutes = null,
  openIncident = null,
} = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const reasons = [];
  const suggestedActions = [];

  const gpsUsable = gpsHealth === "fresh" || gpsHealth === "delayed";
  const gpsDead = gpsHealth === "stale" || gpsHealth === "no-signal";
  const activeTarget = tripPhase === "to_pickup"
    ? "pickup"
    : tripPhase === "to_destination"
    ? "destination"
    : null;

  // ── Live ETA ────────────────────────────────────────────────────────────
  // A dead GPS never yields an ETA: an old value presented as live is the
  // exact lie this module exists to prevent. Delayed GPS still has an ETA,
  // but the reason notes the staleness so the UI can caveat it.
  let liveEta = null;
  if (gpsDead || !gpsUsable || liveTargetMinutes == null) {
    if (gpsDead) reasons.push("GPS is offline — arrival projection unavailable.");
  } else {
    liveEta = new Date(nowMs + Number(liveTargetMinutes) * 60000).toISOString();
    if (gpsHealth === "delayed") reasons.push("GPS updates are delayed — arrival projection may be stale.");
  }

  // ── Schedule delay ──────────────────────────────────────────────────────
  // Only against a truthful baseline (request pickup_datetime / dispatch
  // scheduled_arrival). No baseline → null, never an invented target time.
  const baselineAt = activeTarget === "pickup"
    ? scheduledPickupAt
    : activeTarget === "destination"
    ? scheduledArrivalAt
    : null;
  const baselineMs = toMs(baselineAt);
  let targetDelayMin = null;
  if (baselineMs != null && liveEta != null) {
    targetDelayMin = Math.round((toMs(liveEta) - baselineMs) / 60000);
  }
  if (baselineMs == null && activeTarget) {
    reasons.push(`No scheduled ${activeTarget} baseline — delay cannot be computed truthfully.`);
  }

  // trafficDelayMinutes null = unknown; 0 = provider reports no delay. Never
  // let Number(null)===0 launder "unknown" into "no traffic".
  const trafficDelayMin = trafficDelayMinutes != null
    && Number.isFinite(Number(trafficDelayMinutes))
    && trafficDelayMinutes >= 0
    ? Math.round(Number(trafficDelayMinutes))
    : null;
  if (trafficDelayMin != null && trafficDelayMin >= WATCH_DELAY_MIN) {
    reasons.push(`Traffic is adding about ${trafficDelayMin} min to this leg.`);
  }

  // ── Next ASSIGNED trip impact ───────────────────────────────────────────
  // projectedCurrentFinish = arrival at the active target + (still before
  // pickup? the whole passenger leg) ; slack subtracts the reposition drive.
  let nextTrip = { slackMin: null, impact: null, nextPickupAt: null, atRisk: null };
  const nextMs = toMs(nextAssignedPickupAt);
  if (nextMs != null && liveEta != null) {
    const remainingPassengerMin = activeTarget === "pickup" && Number.isFinite(Number(plannedPassengerMinutes))
      ? Number(plannedPassengerMinutes)
      : 0;
    const repositionMin = repositionMinutes != null
      && Number.isFinite(Number(repositionMinutes))
      && Number(repositionMinutes) >= 0
      ? Number(repositionMinutes)
      : null;
    const finishMs = toMs(liveEta) + remainingPassengerMin * 60000;
    const rawSlackMin = minutesBetween(
      repositionMin != null ? finishMs + repositionMin * 60000 : finishMs,
      nextMs
    );
    if (repositionMin != null && rawSlackMin != null) {
      nextTrip = {
        slackMin: Math.round(rawSlackMin),
        impact: nextTripImpactSentence({ slackMin: Math.round(rawSlackMin) }),
        nextPickupAt: new Date(nextMs).toISOString(),
        atRisk: rawSlackMin < TURNAROUND_SAFETY_MIN,
      };
    } else {
      reasons.push("Reposition drive to the next assigned pickup is unknown — next-trip impact cannot be computed.");
    }
  }

  // ── Risk condensation ───────────────────────────────────────────────────
  const candidates = [];

  const dRisk = delayRisk(targetDelayMin);
  if (dRisk) {
    candidates.push(dRisk);
    if (targetDelayMin >= WATCH_DELAY_MIN) {
      reasons.push(`Projected to be ~${Math.round(targetDelayMin)} min behind the scheduled ${activeTarget} time.`);
    }
  }
  if (nextTrip.slackMin != null && nextTrip.slackMin < 0) {
    candidates.push(RISK_LEVELS.ACTION);
    reasons.push("Projected to MISS the next assigned pickup.");
    suggestedActions.push("Review Reassignment");
  } else if (nextTrip.atRisk) {
    candidates.push(RISK_LEVELS.WATCH);
    reasons.push(`Next assigned pickup has only ${nextTrip.slackMin} min of slack (safety floor is ${TURNAROUND_SAFETY_MIN} min).`);
  }
  if (offRouteState === "off_route") {
    candidates.push(RISK_LEVELS.ATTENTION);
    reasons.push(offRouteDistanceM != null
      ? `Route deviation confirmed — ${Math.round(offRouteDistanceM)} m from the expected route.`
      : "Route deviation confirmed.");
    suggestedActions.push("Contact Driver");
  }
  if (openIncident) {
    const sev = String(openIncident.severity || "");
    if (sev === "Critical" || sev === "Major") {
      candidates.push(RISK_LEVELS.ATTENTION);
      reasons.push(`Open ${sev.toLowerCase()} incident: ${openIncident.incident_type}.`);
      suggestedActions.push("View Incident");
    }
  }
  if (gpsDead) {
    reasons.push("Telemetry problem: no usable GPS signal.");
    suggestedActions.push("Check GPS");
  }

  // UNKNOWN floor (locked): a trip is called NORMAL only on a KNOWN-healthy
  // delay signal. "Delay unknown, nothing else wrong" is UNKNOWN — "I can't
  // tell" must never read as "all good".
  const risk = candidates.length
    ? candidates.reduce((worst, c) => (SEVERITY_RANK[c] > SEVERITY_RANK[worst] ? c : worst))
    : RISK_LEVELS.UNKNOWN;

  if (risk === RISK_LEVELS.ACTION) suggestedActions.push("View Trip");
  if (risk === RISK_LEVELS.ATTENTION || risk === RISK_LEVELS.ACTION) {
    suggestedActions.unshift("Assess Situation");
  }

  return {
    risk,
    activeTarget,
    liveEta,
    targetDelayMin,
    trafficDelayMin,
    offRoute: {
      state: offRouteState ?? "unknown",
      distanceM: offRouteDistanceM != null ? Math.round(Number(offRouteDistanceM)) : null,
    },
    nextTrip,
    gps: { health: gpsHealth ?? "unknown", accuracyM: gpsAccuracyM != null ? Number(gpsAccuracyM) : null },
    reasons,
    suggestedActions: [...new Set(suggestedActions)],
  };
}

/** Sort rank for fleet summaries: worst first, UNKNOWN with telemetry problems. */
export function fleetSortRank(risk) {
  // ACTION → ATTENTION → UNKNOWN (can't tell / telemetry problem) → WATCH → NORMAL
  switch (risk) {
    case RISK_LEVELS.ACTION: return 0;
    case RISK_LEVELS.ATTENTION: return 1;
    case RISK_LEVELS.UNKNOWN: return 2;
    case RISK_LEVELS.WATCH: return 3;
    case RISK_LEVELS.NORMAL: return 4;
    default: return 2;
  }
}
