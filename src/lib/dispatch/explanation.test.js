import { it, expect } from 'vitest';
import { buildExplanationSnapshot, signExplanationSnapshot, verifyExplanationSnapshot, diffExplanationSnapshots } from './explanation';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-explanation';

const ev = (pairs, extra = {}) => ({ requestId: 502, pickupAt: '2026-09-16T10:00:00+08:00', evaluatedAt: '2026-09-16T09:00:00Z', pairs, exclusions: [], recommended: pairs[0] ? { vehicleId: pairs[0].vehicleId, driverId: pairs[0].driverId } : null, ...extra });
const pair = (over = {}) => ({ vehicleId: 1, driverId: 2, state: 'ALL_CLEAR', routeVerdict: 'SAFE', scheduleEvidence: { usableSlackMinutes: 85, releaseAt: '2026-09-16T09:00:00+08:00', releaseSource: 'scheduled' }, workloadEvidence: { complete: true, serviceDate: '2026-09-16', completedTrips: 1, activeTrips: 0, scheduledTrips: 2 }, checks: [{ id: 'capacity', status: 'verified' }], decisionEvidence: { code: 'OK' }, ...over });

it('round-trips a signed snapshot and rejects cross-request use', () => {
  const snap = buildExplanationSnapshot(ev([pair()]));
  const token = signExplanationSnapshot(snap);
  expect(verifyExplanationSnapshot(token, { requestId: 502 }).requestId).toBe(502);
  expect(() => verifyExplanationSnapshot(token, { requestId: 999 })).toThrowError(expect.objectContaining({ code: 'SCOPE' }));
  expect(() => verifyExplanationSnapshot(token.slice(0, -2) + 'xx', { requestId: 502 })).toThrow();
});

it('reports no change for timestamp-only refresh and suppresses slack jitter', () => {
  const a = buildExplanationSnapshot(ev([pair()]));
  const b = buildExplanationSnapshot(ev([pair({ scheduleEvidence: { usableSlackMinutes: 87, releaseAt: '2026-09-16T09:00:00+08:00', releaseSource: 'scheduled' } })], { evaluatedAt: '2026-09-16T09:01:00Z' }));
  const diff = diffExplanationSnapshots(a, b);
  expect(diff.changed).toBe(false);
  expect(diff.fingerprint).toBeNull();
});

it('detects eligibility, disappeared and recommendation changes by stable identity', () => {
  const a = buildExplanationSnapshot(ev([pair(), pair({ vehicleId: 3, driverId: 4 })]));
  const b = buildExplanationSnapshot(ev([pair({ state: 'BLOCKED' })], { recommended: { vehicleId: 1, driverId: 2 } }));
  const diff = diffExplanationSnapshots(a, b);
  expect(diff.changed).toBe(true);
  expect(diff.changes.some(c => c.type === 'eligibility')).toBe(true);
  expect(diff.changes.some(c => c.type === 'disappeared')).toBe(true);
});
