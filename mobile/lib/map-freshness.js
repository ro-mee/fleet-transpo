export function observationIsFresh(observedAt, now, maxAgeMs) {
  if (observedAt == null || observedAt === '') return false;
  const at = typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  return Number.isFinite(at) && at <= now + 30000 && now - at <= maxAgeMs;
}

export function localGpsState(observedAt, error, now) {
  if (error || !observationIsFresh(observedAt, now, 90000)) return 'lost';
  return observationIsFresh(observedAt, now, 30000) ? 'fresh' : 'delayed';
}
