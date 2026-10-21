import { describe, expect, it } from 'vitest';
import { evaluateGuideEligibility } from './driver-guide-policy';

const base = { kind: 'automatic', now: 100000, foreground: true, emergency: false, responderWork: false, actorConfirmed: true, workspace: 'cargo', contextValid: true, routeReady: true, targetReady: true, hasAssignment: false, hasPendingSubmission: false, parkedConfirmed: true, motion: { speedMs: 0, observedAt: 99900, movingHold: false } };
describe('driver guidance safety policy', () => {
  it('allows only fresh stationary automatic guidance with valid visible context', () => {
    expect(evaluateGuideEligibility(base).allowed).toBe(true);
    for (const patch of [{ foreground: false }, { emergency: true }, { responderWork: true }, { actorConfirmed: false }, { workspace: 'unclassified' }, { contextValid: false }, { routeReady: false }, { targetReady: false }, { now: NaN }]) expect(evaluateGuideEligibility({ ...base, ...patch }).allowed).toBe(false);
    for (const speedMs of [null, undefined, NaN, Infinity, -1, 0.51, 3]) expect(evaluateGuideEligibility({ ...base, motion: { ...base.motion, speedMs } }).allowed).toBe(false);
    for (const observedAt of [0, null, 69999, 101000]) expect(evaluateGuideEligibility({ ...base, motion: { ...base.motion, observedAt } }).allowed).toBe(false);
    expect(evaluateGuideEligibility({ ...base, motion: { ...base.motion, movingHold: true } }).allowed).toBe(false);
  });
  it('never treats a parked confirmation as clearance to practise during work or movement', () => {
    const p = { ...base, kind: 'practice' };
    for (const patch of [{ hasAssignment: true }, { hasPendingSubmission: true }, { parkedConfirmed: false }, { emergency: true }]) expect(evaluateGuideEligibility({ ...p, ...patch }).allowed).toBe(false);
    expect(evaluateGuideEligibility({ ...p, motion: { speedMs: 2, observedAt: 99990, movingHold: false } })).toMatchObject({ allowed: false, reason: 'movement' });
  });
  it('permits deliberate idle practice without GPS but never silently downgrades stale known-motion practice', () => {
    const p = { ...base, kind: 'practice', motion: { speedMs: null, observedAt: null, movingHold: false } };
    expect(evaluateGuideEligibility(p)).toMatchObject({ allowed: true, reason: 'parked_confirmation' });
    expect(evaluateGuideEligibility({ ...p, knownMotionAtEntry: true }).allowed).toBe(false);
    expect(evaluateGuideEligibility({ ...base, kind: 'details', motion: null }).allowed).toBe(true);
  });
  it('fails closed for incomplete work and emergency snapshots', () => {
    expect(evaluateGuideEligibility({ ...base, kind: 'practice', hasAssignment: undefined }).allowed).toBe(false);
    expect(evaluateGuideEligibility({ ...base, emergency: undefined }).allowed).toBe(false);
  });
});
