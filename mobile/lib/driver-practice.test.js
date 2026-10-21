import { describe, expect, it } from 'vitest';
import { createPracticeSession, reducePractice, getPracticeStep, PRACTICE_DURATION_MS } from './driver-practice';
const make = (topic = 'passenger.pickup', variant = 'passenger') => createPracticeSession({ id: 'sample-1', epoch: 1, actorId: '17', topic, variant, now: 1000, eligibility: { allowed: true, reason: 'stationary' } });
const event = (s, type, payload) => ({ sessionId: s.id, epoch: s.epoch, stepId: getPracticeStep(s)?.id, type, payload });
describe('memory-only practice state', () => {
  it('requires explicit eligibility, identity and a supported guide', () => {
    expect(make().expiresAt).toBe(1000 + PRACTICE_DURATION_MS);
    for (const patch of [{ eligibility: { allowed: false } }, { actorId: null }, { topic: 'sos' }, { variant: 'unclassified' }]) expect(createPracticeSession({ id: 's', epoch: 1, actorId: '17', topic: 'passenger.pickup', variant: 'passenger', now: 1000, eligibility: { allowed: true }, ...patch })).toBeNull();
  });
  it('uses real Passenger status labels and advances once on a valid swipe only', () => {
    const s = make(); expect(getPracticeStep(s).label).toBe('ARRIVED AT PICKUP');
    expect(reducePractice(s, event(s, 'swipe', { success: false }), 1001)).toBe(s);
    const e = event(s, 'swipe', { success: true }); const next = reducePractice(s, e, 1001);
    expect(next.data.trip.trip_status).toBe('At Pickup'); expect(getPracticeStep(next).label).toBe('PICKED UP GUEST');
    expect(reducePractice(next, e, 1002)).toBe(next);
    expect(s.data.trip.trip_status).toBe('Trip Started');
  });
  it('rejects late, foreign and expired events without completing a sample', () => {
    const s = make();
    expect(reducePractice(s, { ...event(s, 'swipe', { success: true }), epoch: 0 }, 1001)).toBe(s);
    expect(reducePractice(s, event(s, 'swipe', { success: true }), s.expiresAt)).toBeNull();
    expect(reducePractice(s, event(s, 'swipe', { success: true }), 999)).toBeNull();
  });
  it('requires correcting a receipt against its sample printed total', () => {
    const s = make('fuel.receipt', 'cargo');
    expect(reducePractice(s, event(s, 'receipt.review', { total: '2911.75', liters: '45.5' }), 1001)).toBe(s);
    expect(reducePractice(s, event(s, 'receipt.review', { total: '2911.25', liters: '45.5' }), 1001).phase).toBe('complete');
  });
});


describe('shared-view sample tasks', () => {
  it('requires every inspection answer and a reason for the fictional fault', () => {
    const s = make('inspection.quick');
    expect(s).not.toBeNull();
    const answers = Object.fromEntries(s.data.items.map(item => [item.id, 'PASS']));
    answers[s.data.items[0].id] = 'FAIL';
    expect(reducePractice(s, event(s, 'inspection.review', { answers, remarks: {} }), 1001)).toBe(s);
    expect(reducePractice(s, event(s, 'inspection.review', { answers, remarks: { [s.data.items[0].id]: 'Sample fault: visible tire damage' } }), 1001).phase).toBe('complete');
  });
  it('uses new sample evidence and a verified reading without changing a trip', () => {
    const s = make('odometer.end', 'cargo');
    expect(reducePractice(s, event(s, 'odometer.review', { reading: 12345, photo: false }), 1001)).toBe(s);
    const next = reducePractice(s, event(s, 'odometer.review', { reading: 12345, photo: true }), 1001);
    expect(next.phase).toBe('complete'); expect(next.data.trip).toEqual(s.data.trip);
  });
  it('requires gauge evidence, leaves a sample fuel request pending, and never approves it', () => {
    const s = make('fuel.request');
    expect(reducePractice(s, event(s, 'fuel.request', { percent: 100, photo: true, purpose: 'Sample shift' }), 1001)).toBe(s);
    expect(reducePractice(s, event(s, 'fuel.request', { percent: 25, photo: false, purpose: 'Sample shift' }), 1001)).toBe(s);
    const next = reducePractice(s, event(s, 'fuel.request', { percent: 25, photo: true, purpose: 'Sample shift' }), 1001);
    expect(next.phase).toBe('complete'); expect(next.data.requestStatus).toBe('Pending');
  });
  it('validates Cargo units and shortage reasons before sample signature review', () => {
    const s = make('cargo.manifest', 'cargo');
    const line = s.data.execution.manifest.lines[0].line_id;
    expect(reducePractice(s, event(s, 'cargo.review', { counts: { [line]: '9.5' }, issues: {} }), 1001)).toBe(s);
    expect(reducePractice(s, event(s, 'cargo.review', { counts: { [line]: '9' }, issues: {} }), 1001)).toBe(s);
    const next = reducePractice(s, event(s, 'cargo.review', { counts: { [line]: '9' }, issues: { [line]: { remarks: 'Only nine sample boxes present' } } }), 1001);
    expect(next.step).toBe(1); expect(next.data.signedReceipt).toBeNull();
    expect(next.data.execution.can_depart).toBe(false);
  });
});

it('requires a fresh Cargo signature after a real local recount and keeps the previous observation only in memory', () => {
  let s = make('cargo.manifest', 'cargo');
  const id = s.data.execution.manifest.lines[0].line_id;
  const handover = { version: 1, signer_name: 'Fictional staff', signer_role_or_dept: 'Sample warehouse', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-21T00:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[10, 20], [80, 100], [150, 50]]] }, location: null };
  const apply = (type, payload) => { s = reducePractice(s, event(s, type, payload), 1001); };
  apply('cargo.review', { counts: { [id]: '9' }, issues: { [id]: { remarks: 'One fictional box missing' } } });
  apply('cargo.sign', { handover }); expect(s.step).toBe(2);
  apply('cargo.wait', { action: 'wait' }); apply('cargo.recount', { action: 'recount' });
  expect(s.step).toBe(0); expect(s.data.signedReceipt).toBeNull(); expect(s.data.previousObservations).toHaveLength(1);
  apply('cargo.review', { counts: { [id]: '9' }, issues: { [id]: { remarks: 'Old sample count' } } }); expect(s.step).toBe(0);
  apply('cargo.review', { counts: { [id]: '10' }, issues: {} }); apply('cargo.sign', { handover });
  expect(s.step).toBe(4); expect(s.data.execution.can_depart).toBe(false);
  apply('cargo.securement', { answer: 'separate' }); apply('cargo.authority', { answer: 'server' });
  expect(s.phase).toBe('complete'); expect(s.data.execution.can_complete).toBe(false);
});

it('uses actual decimal-unit validation and exposes unavailable or unsynced holds without enabling them', () => {
  let s = make('cargo.manifest', 'cargo');
  s = reducePractice(s, event(s, 'cargo.case', { case: 'measured' }), 1001);
  const id = s.data.execution.manifest.lines[0].line_id;
  expect(s.data.execution.manifest.lines[0].unit).toBe('kg');
  expect(reducePractice(s, event(s, 'cargo.review', { counts: { [id]: '9.2501' }, issues: { [id]: { remarks: 'Fictional shortfall' } } }), 1001)).toBe(s);
  expect(reducePractice(s, event(s, 'cargo.review', { counts: { [id]: '9.25' }, issues: { [id]: { remarks: 'Fictional shortfall' } } }), 1001).step).toBe(1);
  for (const value of ['unavailable', 'unsynced']) {
    const next = reducePractice(s, event(s, 'cargo.case', { case: value }), 1001);
    expect(next.data.execution.can_depart).toBe(false); expect(next.data.signedReceipt).toBeNull();
  }
});
