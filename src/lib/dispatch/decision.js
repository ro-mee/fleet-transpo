// Presentation of authoritative checks, never another eligibility/ranking engine.
export const DECISION_LABELS = { ALL_CLEAR: 'Ready for confirmation', REVIEW_REQUIRED: 'Review required', BLOCKED: 'Blocked', INSUFFICIENT_DATA: 'Needs verification' };

// Fuel-level findings are engine records, never user-facing: dispatch never
// refuses a pair for fuel, so fuel text is filtered out of every reason,
// chip, warning and narration surface. Matches "Fuel at N%", "top-up",
// "refuel" and "Sufficient fuel level" phrasing from vehicleRisks().
export function isFuelNoise(message) {
  return typeof message === 'string' && /fuel/i.test(message);
}

// Presentation of the existing confirmation gates; the server still revalidates every assignment.
export function dispatchConfirmation({ canAssign, pair, decision, fetching = false, error = false,
  pending = false, failure = null, queue = null, reason = '', now = Date.now() }) {
  const disabled = (message, recovery = null) => ({ canSubmit: false, message, recovery });
  if (pending) return disabled('Confirming assignment…');
  if (failure?.checking) return disabled('Assignment outcome is uncertain. Open the request before retrying.', 'request');
  if (!canAssign) return disabled('You do not have permission to assign resources.');
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
    if (!queue.validation?.isSuccess || queue.validation?.isFetching) return disabled('Checking current queue availability…');
    if (queue.proposal.pair?.vehicle_id !== pair?.vehicle_id || queue.proposal.pair?.driver_id !== pair?.driver_id)
      return disabled('Recheck this selected pair against the queue before confirmation.', 'analyze');
    if (queue.proposal.outcome !== 'VERIFIED' && queue.proposal.confirmationMode !== 'manual') return disabled('This queue proposal is not verified for confirmation.', 'analyze');
  }
  if (failure) return disabled(failure.message || 'Assignment needs review. Recheck this reservation.', 'recheck');
  if (fetching) return disabled('Checking current availability…');
  if (error || decision.stale) return disabled('Current evidence is unavailable or expired. Recheck this reservation.', 'recheck');
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
