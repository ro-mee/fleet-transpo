// Presentation of authoritative checks, never another eligibility/ranking engine.
export const DECISION_LABELS = { ALL_CLEAR: 'Ready for confirmation', REVIEW_REQUIRED: 'Review required', BLOCKED: 'Blocked', INSUFFICIENT_DATA: 'Needs verification' };

// Phase 1 — stable recovery reason codes. Advisory only: opening a record never
// changes its status and an excluded vehicle is never selectable via recovery.
export const RECOVERY_CODES = {
  CAPACITY_MISMATCH: 'CAPACITY_MISMATCH',
  VEHICLE_STATUS: 'VEHICLE_STATUS',
  MAINTENANCE_CONFLICT: 'MAINTENANCE_CONFLICT',
  PAIRING: 'PAIRING',
  DRIVER_UNAVAILABLE: 'DRIVER_UNAVAILABLE',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
  REGISTRATION_EXPIRED: 'REGISTRATION_EXPIRED',
  INSURANCE_EXPIRED: 'INSURANCE_EXPIRED',
  UVVRP_RESTRICTED: 'UVVRP_RESTRICTED',
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  ROUTE_EVIDENCE: 'ROUTE_EVIDENCE',
  REQUEST_EVIDENCE: 'REQUEST_EVIDENCE',
  UNKNOWN: 'UNKNOWN',
};

// Allowlisted navigation targets. URLs are resolved in application code, never
// from model prose.
export const RECOVERY_RECORDS = ['vehicle', 'driver', 'maintenance', 'schedule', 'request'];

function recoveryForCheckId(id, ctx = {}) {
  switch (id) {
    case 'capacity': return { code: RECOVERY_CODES.CAPACITY_MISMATCH, fix: 'choice', label: 'Needs a larger vehicle', record: 'request', id: ctx.requestId ?? null, hint: 'This pair is too small; choose a larger vehicle class.' };
    case 'maintenance': return { code: RECOVERY_CODES.MAINTENANCE_CONFLICT, fix: 'record', label: 'Check maintenance record', record: 'maintenance', id: ctx.vehicleId ?? null, hint: 'Complete or reschedule the service window for this vehicle.' };
    case 'pairing': return { code: RECOVERY_CODES.PAIRING, fix: 'record', label: 'Check substitute schedule', record: 'schedule', id: ctx.vehicleId ?? null, hint: 'Add a dated substitute or confirm the custodian for the pickup date.' };
    // `schedule` resolves to the DRIVER, and that is a dependency on the
    // upstream candidate filters, not a property of this function. conflicts.js
    // (:592) groups four conflict types into this one check — driver_unavailable
    // and driver_conflict are driver-sourced, but vehicle_status and
    // vehicle_conflict are not. Those two never reach a pair here: the SQL
    // pre-filter in fetchCandidates drops grounded vehicles (they surface as
    // prefiltered exclusions instead) and buildFleetPairRecommendations skips a
    // vehicle whose `_schedule_load > 0` (pair-scoring.js:634/:645), which is
    // also what conflicts.js:575 re-tests. A blocking `schedule` check on a pair
    // is therefore always driverBlockReason's: approved leave, rest day, outside
    // shift, during break. FM-VEH-007 freezes this, so widening either filter —
    // or adding a vehicle-sourced type to conflicts.js:592 — fails the suite
    // rather than silently mislabelling a vehicle fault as "Pick an available
    // driver".
    case 'schedule': return { code: RECOVERY_CODES.DRIVER_UNAVAILABLE, fix: 'choice', label: 'Pick an available driver', record: 'schedule', id: ctx.driverId ?? null, hint: 'This driver is unavailable for the window; choose an available driver.' };
    case 'registration': return { code: RECOVERY_CODES.REGISTRATION_EXPIRED, fix: 'record', label: 'Renew vehicle registration', record: 'vehicle', id: ctx.vehicleId ?? null, hint: 'Renew the registration on the vehicle record.' };
    case 'insurance': return { code: RECOVERY_CODES.INSURANCE_EXPIRED, fix: 'record', label: 'Renew vehicle insurance', record: 'vehicle', id: ctx.vehicleId ?? null, hint: 'Renew the insurance on the vehicle record.' };
    case 'license': return { code: RECOVERY_CODES.LICENSE_EXPIRED, fix: 'record', label: 'Renew driver license', record: 'driver', id: ctx.driverId ?? null, hint: 'Renew the license on the driver record.' };
    case 'incidents': return { code: RECOVERY_CODES.VEHICLE_STATUS, fix: 'record', label: 'Check incident record', record: 'vehicle', id: ctx.vehicleId ?? null, hint: 'Resolve the blocking incident for this vehicle.' };
    case 'category': return { code: RECOVERY_CODES.CAPACITY_MISMATCH, fix: 'choice', label: 'Check vehicle class', record: 'request', id: ctx.requestId ?? null, hint: 'Confirm the requested vehicle class.' };
    case 'request': return { code: RECOVERY_CODES.REQUEST_EVIDENCE, fix: 'verify', label: 'Check reservation details', record: 'request', id: ctx.requestId ?? null, hint: 'Confirm pickup time and passenger count.' };
    default: return { code: RECOVERY_CODES.UNKNOWN, fix: 'verify', label: 'Recheck this reservation', record: 'request', id: ctx.requestId ?? null, hint: 'Recheck to refresh the current evidence.' };
  }
}

// Map one authoritative check to a single advisory recovery action.
// Never classifies by display prose: check.id decides, message is evidence only.
export function recoveryActionForCheck(check = {}, ctx = {}) {
  if (!check || (check.status !== 'blocking' && check.status !== 'missing')) return null;
  const base = recoveryForCheckId(check.id, ctx);
  return { ...base, status: check.status, message: check.message ?? null };
}

// Fixable record issues first, then missing-evidence verification, then
// choice-bound blockers (another vehicle/driver/date). Advisory order only.
const FIX_ORDER = { record: 0, verify: 1, choice: 2 };
export function sortRecoveryActions(actions = []) {
  return [...actions].sort((a, b) => (FIX_ORDER[a?.fix] ?? 3) - (FIX_ORDER[b?.fix] ?? 3));
}

// Map a recorded exclusion (engine or pre-filtered) to advisory recovery.
// Prefiltered rows carry plate + status/seats reason only.
export function recoveryActionForExclusion(exclusion = {}, ctx = {}) {
  const reason = String(exclusion?.reason ?? '');
  const vehicleId = exclusion?.vehicleId ?? ctx.vehicleId ?? null;
  if (/too small for/i.test(reason)) return { code: RECOVERY_CODES.CAPACITY_MISMATCH, fix: 'choice', label: 'Needs a larger vehicle', record: 'request', id: ctx.requestId ?? null, hint: 'Too small for this party; choose a larger vehicle class.', vehicleId };
  if (/insurance/i.test(reason)) return { code: RECOVERY_CODES.INSURANCE_EXPIRED, fix: 'record', label: 'Renew vehicle insurance', record: 'vehicle', id: vehicleId, hint: reason, vehicleId };
  if (/registration/i.test(reason)) return { code: RECOVERY_CODES.REGISTRATION_EXPIRED, fix: 'record', label: 'Renew vehicle registration', record: 'vehicle', id: vehicleId, hint: reason, vehicleId };
  if (/license/i.test(reason)) return { code: RECOVERY_CODES.LICENSE_EXPIRED, fix: 'record', label: 'Renew driver license', record: 'driver', id: ctx.driverId ?? null, hint: reason, vehicleId };
  if (/number-coding|coding restricted|uvvrp/i.test(reason)) return { code: RECOVERY_CODES.UVVRP_RESTRICTED, fix: 'choice', label: 'Coding-bound: another vehicle or date', record: 'vehicle', id: vehicleId, hint: 'Number coding is date-bound; this vehicle cannot serve that pickup day. Choose another vehicle or move the date.', vehicleId };
  if (/status is/i.test(reason)) return { code: RECOVERY_CODES.VEHICLE_STATUS, fix: 'record', label: 'Check vehicle record', record: 'vehicle', id: vehicleId, hint: reason, vehicleId };
  if (/maintenance/i.test(reason)) return { code: RECOVERY_CODES.MAINTENANCE_CONFLICT, fix: 'record', label: 'Check maintenance record', record: 'maintenance', id: vehicleId, hint: reason, vehicleId };
  if (/substitute|pairing|custodian/i.test(reason)) return { code: RECOVERY_CODES.PAIRING, fix: 'record', label: 'Check substitute schedule', record: 'schedule', id: vehicleId, hint: reason, vehicleId };
  if (/leave|schedule|shift|off duty|suspended/i.test(reason)) return { code: RECOVERY_CODES.DRIVER_UNAVAILABLE, fix: 'choice', label: 'Pick an available driver', record: 'schedule', id: ctx.driverId ?? null, hint: reason, vehicleId };
  if (/route|location|gps|transfer|duration/i.test(reason)) return { code: RECOVERY_CODES.ROUTE_EVIDENCE, fix: 'verify', label: 'Verify route evidence', record: 'request', id: ctx.requestId ?? null, hint: reason, vehicleId };
  return { code: RECOVERY_CODES.UNKNOWN, fix: 'verify', label: 'Recheck this reservation', record: 'request', id: ctx.requestId ?? null, hint: reason || 'No detailed reason recorded.', vehicleId };
}

// Fuel-level findings are engine records, never user-facing: dispatch never
// refuses a pair for fuel, so fuel text is filtered out of every reason,
// chip, warning and narration surface. Matches "Fuel at N%", "top-up",
// "refuel" and "Sufficient fuel level" phrasing from vehicleRisks().
export function isFuelNoise(message) {
  return typeof message === 'string' && /fuel/i.test(message);
}

// Presentation of the existing confirmation gates; the server still revalidates every assignment.
//
// `awaitingResult` means "the caller has no result to act on yet" — a first load
// — NOT "a request is in flight". It used to take `query.isFetching`, which is
// also true during every background refresh, so the primary Assign button greyed
// out on each poll and on every window focus. Worse, the branch sat above the
// error/stale branch, so an in-flight refresh masked a known blocker and reported
// "Checking current availability…" instead of the real reason. Callers pass
// first-load state (isLoading) and the order below keeps error/stale authoritative.
export function dispatchConfirmation({ canAssign, pair, decision, awaitingResult = false, error = false,
  pending = false, failure = null, queue = null, reason = '', now = Date.now() }) {
  const disabled = (message, recovery = null) => ({ canSubmit: false, message, recovery });
  if (pending) return disabled('Confirming assignment…');
  if (failure?.checking) return disabled('Assignment outcome is uncertain. Open the request before retrying.', 'request');
  if (!canAssign) return disabled('You do not have permission to assign resources.');
  // A failed or stale recommendation is authoritative. Check it before queue
  // validation so a queue-loading message cannot hide unavailable evidence.
  if (failure) return disabled(failure.message || 'Assignment needs review. Recheck this reservation.', 'recheck');
  if (error || decision.stale) return disabled('Current evidence is unavailable or expired. Recheck this reservation.', 'recheck');
  if (queue?.analyzing) return disabled('Analyzing the selected service date…');
  if (queue?.invalidReason) return disabled(queue.invalidReason, 'analyze');
  if (queue) {
    if (!queue.plan) return disabled('Analyze this service date before confirming a queue proposal.', 'analyze');
    if (!Number.isFinite(+new Date(queue.plan.expiresAt)) || +new Date(queue.plan.expiresAt) <= now)
      return disabled('Queue plan expired. Analyze this service date again.', 'analyze');
    if (!queue.proposal) return disabled('This reservation has no proposal in this queue analysis.', 'analyze');
    if (queue.proposal.dependsOnRequestIds?.length) return disabled('Waiting for the preceding reservation. Confirm it, then analyze again.', 'analyze');
    if (!queue.token) return disabled('Queue proposal has no valid confirmation token. Analyze again.', 'analyze');
    if (queue.validation?.isError) return disabled('Queue validation failed. Analyze this service date again.', 'analyze');
    // Only a validation with no successful result yet blocks. A poll landing on a
    // current successful validation is a background refresh and must not disable
    // Assign — plan expiry, invalidation, the signed token and the server's own
    // assignment revalidation stay authoritative on staleness.
    if (!queue.validation?.isSuccess) return disabled('Checking current queue availability…');
    if (queue.proposal.pair?.vehicle_id !== pair?.vehicle_id || queue.proposal.pair?.driver_id !== pair?.driver_id)
      return disabled('Recheck this selected pair against the queue before confirmation.', 'analyze');
    if (queue.proposal.outcome !== 'VERIFIED' && queue.proposal.confirmationMode !== 'manual') return disabled('This queue proposal is not verified for confirmation.', 'analyze');
  }
  if (awaitingResult) return disabled('Checking current availability…');
  if (!pair) return disabled('No current pair is selected. Review exclusions or recheck this reservation.', 'recheck');
  if (!decision.canConfirm && !decision.canReview)
    return disabled(decision.reasons[0] || (decision.state === 'BLOCKED' ? 'Resolve the blocking checks before confirming.' : 'Required evidence needs verification.'), 'recheck');
  if (!decision.canConfirm && !reason.trim()) return disabled('Enter the manual verification reason before review.');
  return { canSubmit: true, message: decision.canConfirm ? 'Ready to review this pair.' : 'Manual verification required. Review the reason and pair.', recovery: null };
}
export function evidenceExpired(pair, now = Date.now()) {
  return [pair?.evidenceExpiresAt, pair?.proximity?.expiresAt, pair?.dispatchContext?.evidenceExpiresAt, pair?.temporalContext?.nextBoundaryAt]
    .filter(value => value != null).some(value => !Number.isFinite(+new Date(value)) || +new Date(value) <= now);
}
export function dispatchDecision(pair, { stale = false, now = Date.now() } = {}) {
  const checks = pair?.checks ?? [];
  const blockers = (pair?.hardConflicts ?? []).filter(c => !c.reviewable);
  const expired = stale || evidenceExpired(pair, now);
  const forecast = pair?.vehicle?.maintenance;
  const serviceAdvice = forecast?.basis && ['high','critical','overdue'].includes(forecast.risk) ? [`Service forecast is ${forecast.risk}; review maintenance advice before departure.`] : [];
  const blocked = blockers.length > 0 || checks.some(c=>c.status==='blocking') || pair?.feasibility?.verdict === 'INFEASIBLE' || pair?.dispatchContext?.reasonCode === 'STANDBY_NOT_VERIFIED';
  const missing = !checks.length || checks.some(c => c.status === 'missing') || pair?.evaluated === false;
  const state = blocked ? 'BLOCKED' : expired || missing || !pair?.feasibility || pair.feasibility.verdict === 'UNKNOWN'
    ? 'INSUFFICIENT_DATA' : pair.feasibility.verdict === 'TIGHT' || serviceAdvice.length > 0
      ? 'REVIEW_REQUIRED' : pair.readiness === 'VERIFIED' && pair.feasibility.verdict === 'SAFE' ? 'ALL_CLEAR' : 'INSUFFICIENT_DATA';
  return { state, label: DECISION_LABELS[state], stale: expired,
    canConfirm: !expired && state === 'ALL_CLEAR',
    canReview: !expired && !blocked && !missing && pair?.reviewable === true,
    reasons: [...blockers.map(c => c.message), ...checks.filter(c => c.status === 'missing').map(c => c.message), ...(pair?.feasibility?.reasons ?? []), ...(pair?.advisories ?? []).filter(c => !isFuelNoise(c?.message)).map(c => c.message), ...serviceAdvice] };
}

export function bucketProposal(p, now = Date.now()) {
  if (!p) return 'Not evaluated';
  if (p.outcome === 'NOT_EVALUATED') return 'Not evaluated';
  if (p.dependsOnRequestIds?.length) return 'Waiting for preceding request';
  if (!p.pair) return p.candidateEvaluationComplete ? 'Needs verification' : 'Not evaluated';
  return DECISION_LABELS[dispatchDecision(p.pair, { now }).state] || 'Needs verification';
}
