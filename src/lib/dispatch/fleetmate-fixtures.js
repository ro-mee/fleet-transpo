// Shared fixtures for the FleetMate scenario suite.
//
// These builders reproduce the exact shape the deterministic engine hands to
// conversationEvidence() (see src/services/dispatch-radar.service.js
// evaluateDispatchCandidate and src/lib/scheduling/conflicts.js detectRequestConflicts).
// Scenario tests therefore drive the real projection/contract code rather than a
// reimplementation of it. Nothing here asserts behaviour — it only constructs
// inputs. See Capstone/07 - Development/FleetMate Scenario Test Suite.md.

// check ids + labels exactly as detectRequestConflicts() emits them.
export const CHECK_LABELS = {
  request: 'Request requirements',
  capacity: 'Seating capacity',
  registration: 'Vehicle registration',
  insurance: 'Vehicle insurance',
  license: 'Driver license',
  pairing: 'Effective driver and vehicle pairing',
  schedule: 'Duty, leave and resource schedule',
  maintenance: 'Service-window maintenance',
  incidents: 'Blocking incident check',
  category: 'Requested vehicle class',
};

export const CHECK_IDS = Object.keys(CHECK_LABELS);

/**
 * Build the full check array. `blocking` maps check id -> message for checks in
 * the 'blocking' state; `missing` lists check ids in the 'missing' state. Every
 * other check is 'verified'. Mirrors conflicts.js line 594-597.
 */
export function engineChecks({ blocking = {}, missing = [], checks } = {}) {
  if (checks) return checks;
  return CHECK_IDS.map(id => {
    const label = CHECK_LABELS[id];
    if (blocking[id]) return { id, label, status: 'blocking', message: blocking[id] };
    if (missing.includes(id)) return { id, label, status: 'missing', message: `${label} could not be verified.` };
    return { id, label, status: 'verified', message: `${label}: source records checked.` };
  });
}

// Far-future boundary so a fixture is never accidentally treated as stale.
const FUTURE_BOUNDARY = () => new Date(Date.now() + 86_400_000).toISOString();
const PAST = () => new Date(Date.now() - 3_600_000).toISOString();

/**
 * One evaluated candidate pair. Overrides win over every derived default, so a
 * scenario states only what makes it distinctive.
 */
export function makePair(over = {}) {
  const { blocking, missing, checks, ...rest } = over;
  return {
    vehicle_id: 1,
    driver_id: 1,
    vehicle: { plate_number: 'ABC 1234' },
    driver: { driver_name: 'Driver One' },
    checks: engineChecks({ blocking, missing, checks }),
    evaluated: true,
    readiness: 'VERIFIED',
    reviewable: true,
    feasibility: { verdict: 'SAFE', reasons: [] },
    hardConflicts: [],
    advisories: [],
    temporalContext: { horizon: 'FUTURE', urgency: 'SCHEDULED', nextBoundaryAt: FUTURE_BOUNDARY() },
    dispatchContext: { mode: 'SCHEDULED', liveLocationUsed: false, reasonCode: 'FUTURE_PLANNING' },
    scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 },
    workloadEvidence: null,
    reasons: [],
    ...rest,
  };
}

/** check id -> the conflict type detectRequestConflicts() pairs with it (conflicts.js:592). */
export const CONFLICT_TYPE = {
  request: 'request',
  capacity: 'capacity_mismatch',
  registration: 'registration_expired',
  insurance: 'insurance_expired',
  license: 'license_expired',
  pairing: 'pairing',
  schedule: 'driver_unavailable',
  maintenance: 'maintenance_conflict',
  incidents: 'incident',
  category: 'category',
};

/** A pair whose hard blockers make it unassignable (checks AND hardConflicts, as the engine emits both). */
export function blockedPair(blocking, over = {}) {
  return makePair({
    blocking,
    readiness: 'REVIEW_REQUIRED',
    reviewable: false,
    feasibility: { verdict: 'INFEASIBLE', reasons: Object.values(blocking) },
    hardConflicts: Object.entries(blocking).map(([id, message]) => ({ severity: 'blocking', type: CONFLICT_TYPE[id] ?? id, message })),
    ...over,
  });
}

/** A pair that still needs verification (missing required evidence). */
export function unverifiedPair(missing, over = {}) {
  return makePair({
    missing,
    readiness: 'REVIEW_REQUIRED',
    reviewable: false,
    feasibility: { verdict: 'UNKNOWN', reasons: ['Route evidence needs review.'] },
    ...over,
  });
}

/**
 * A live (IMMEDIATE / NEAR_DISPATCH) pair carrying proximity evidence.
 * `proximityExpiresAt` defaults to a valid future instant.
 */
export function immediatePair({ gpsHealth = 'Fresh', etaMinutes = 12, proximityExpiresAt, liveLocationUsed = true, ...over } = {}) {
  return makePair({
    temporalContext: { horizon: 'NEAR_DISPATCH', urgency: 'SHORT_NOTICE', nextBoundaryAt: FUTURE_BOUNDARY() },
    dispatchContext: { mode: 'IMMEDIATE', liveLocationUsed, reasonCode: 'PICKUP_WITHIN_HORIZON', gpsHealth, originType: liveLocationUsed ? 'CURRENT_GPS' : 'NONE' },
    proximity: { etaMinutes, distanceKm: 4.2, distanceBasis: 'ROUTED', source: 'tomtom-live-traffic', expiresAt: proximityExpiresAt ?? FUTURE_BOUNDARY() },
    ...over,
  });
}

/** A pair with a preceding commitment (REPOSITION branch). */
export function repositioningPair(over = {}) {
  return makePair({
    temporalContext: { horizon: 'NEAR_DISPATCH', urgency: 'SHORT_NOTICE', nextBoundaryAt: FUTURE_BOUNDARY() },
    dispatchContext: { mode: 'REPOSITION', liveLocationUsed: false, reasonCode: 'PRECEDING_COMMITMENT', originType: 'PREVIOUS_TRIP_DESTINATION' },
    scheduleEvidence: { usableSlackMinutes: 25, transferMinutes: 20, gapMinutes: 55, preparationMinutes: 10, releaseAt: new Date().toISOString(), releaseSource: 'scheduled' },
    expectedRoute: { etaMinutes: 20, source: 'tomtom-cached', basis: 'Predicted transfer from preceding destination' },
    ...over,
  });
}

/** The server-side request row conversationEvidence() reads. */
export function makeRequest(over = {}) {
  return {
    request_id: 502,
    fleet_status: 'Pending',
    passenger_count: 4,
    pickup_datetime: new Date(Date.now() + 86_400_000).toISOString(),
    ...over,
  };
}

/** The recommendation envelope prepareDispatchRecommendation() returns. */
export function makeRecommendation({ candidates = [], recommended, noneReasons = [], evaluatedAt = '2026-09-17T02:00:00.000Z', evaluation } = {}) {
  return {
    evaluatedAt,
    evaluation: evaluation ?? { evaluated: candidates.length, total: candidates.length },
    pair: {
      candidates,
      recommended: recommended === undefined ? candidates[0] ?? null : recommended,
      alternate: candidates[1] ?? null,
      none_reasons: noneReasons,
    },
  };
}

/** Nothing evaluated, only recorded exclusions. */
export function exclusionOnly(vehicleId, reason, over = {}) {
  return { vehicle_id: vehicleId, plate: over.plate ?? `PLT-${vehicleId}`, reason, prefiltered: over.prefiltered === true };
}

/** Serialised grounding payload — exactly what the route sends as serverEvidence. */
export const asPayload = evidence => JSON.stringify(evidence);

export const PAST_INSTANT = PAST;
export const FUTURE_INSTANT = FUTURE_BOUNDARY;
