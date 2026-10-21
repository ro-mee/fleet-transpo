const GUIDE_MOTION_MAX_AGE_MS = 30000;
const GUIDE_PARKED_MAX_SPEED_MS = 0.5;

export function evaluateGuideEligibility(s = {}) {
  const refuse = reason => ({ allowed: false, reason });
  if (!['automatic', 'details', 'practice'].includes(s.kind) || !Number.isFinite(s.now) || s.now < 0) return refuse('invalid_context');
  if (s.foreground !== true || s.emergency !== false || s.responderWork !== false) return refuse('urgent_or_background');
  if (s.actorConfirmed !== true) return refuse('identity');
  if (s.kind === 'details') return { allowed: true, reason: 'read_only' };
  if (!['common', 'passenger', 'cargo'].includes(s.workspace) || s.contextValid !== true) return refuse('assignment_context');
  const m = s.motion;
  const validSpeed = typeof m?.speedMs === 'number' && Number.isFinite(m.speedMs) && m.speedMs >= 0;
  const validTime = typeof m?.observedAt === 'number' && Number.isFinite(m.observedAt) && m.observedAt > 0 && m.observedAt <= s.now;
  const fresh = validTime && s.now - m.observedAt <= GUIDE_MOTION_MAX_AGE_MS;
  if (m?.movingHold === true || (fresh && validSpeed && m.speedMs > GUIDE_PARKED_MAX_SPEED_MS)) return refuse('movement');
  if (s.kind === 'practice') {
    if (s.hasAssignment !== false || s.hasPendingSubmission !== false) return refuse('work_in_progress');
    if (s.parkedConfirmed !== true) return refuse('parked_confirmation_required');
    if (!fresh || !validSpeed) return s.knownMotionAtEntry ? refuse('motion_stale') : { allowed: true, reason: 'parked_confirmation' };
    return { allowed: true, reason: 'stationary' };
  }
  if (!fresh || !validSpeed) return refuse('motion_unknown');
  if (s.routeReady !== true || s.targetReady !== true) return refuse('target_unavailable');
  return { allowed: true, reason: 'stationary' };
}
