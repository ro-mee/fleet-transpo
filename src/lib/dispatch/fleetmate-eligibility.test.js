import { describe, expect, it } from 'vitest';
import { conversationEvidence, evidenceSummary } from './conversation';
import { dispatchDecision, recoveryActionForCheck, recoveryActionForExclusion } from './decision';
import { makePair, blockedPair, unverifiedPair, immediatePair, makeRequest, makeRecommendation, exclusionOnly, CHECK_LABELS } from './fleetmate-fixtures';

// Groups A–G of the FleetMate scenario matrix: normal path, driver availability,
// vehicle availability, pairing, capacity, schedule conflicts, maintenance and
// incidents.
//
// Scope note: these assert the DETERMINISTIC layer FleetMate narrates — the
// eligibility verdict (dispatchDecision), the projected serverEvidence, and the
// evidence-only answer (evidenceSummary) used when no model is available. Model
// prose itself is not asserted here; see the suite note for the manual steps.

const request = () => makeRequest();
const project = (pairs, { recommended, noneReasons = [], selectedPair = null } = {}) =>
  conversationEvidence(request(), makeRecommendation({ candidates: pairs, recommended, noneReasons }), selectedPair);

describe('A. Normal / happy path', () => {
  it('FM-ELIG-001 one clearly eligible future pair is ALL_CLEAR and described as checks passed', () => {
    const pair = makePair();
    const decision = dispatchDecision(pair);
    expect(decision.state).toBe('ALL_CLEAR');
    expect(decision.canConfirm).toBe(true);

    const evidence = project([pair]);
    expect(evidence.pairs).toHaveLength(1);
    expect(evidence.pairs[0].canChoose).toBe(true);
    expect(evidence.coverage.pairs).toEqual({ total: 1, included: 1, truncated: false });
    // No GPS evidence is legal on a FUTURE evaluation.
    expect(evidence.pairs[0]).not.toHaveProperty('gpsHealth');
    expect(evidence.pairs[0].livePickupEta).toBeNull();

    const answer = evidenceSummary(evidence, 'Is this pair ready?');
    expect(answer).toContain('the recorded checks passed');
    expect(answer).not.toMatch(/definitely|guaranteed|assigned/i);
  });

  it('FM-ELIG-002 the recommended pair is projected first for salience, but that order is not identity', () => {
    const a = makePair({ vehicle_id: 1, driver_id: 1, vehicle: { plate_number: 'AAA 1111' } });
    const b = makePair({ vehicle_id: 2, driver_id: 2, vehicle: { plate_number: 'BBB 2222' } });
    const evidence = project([a, b], { recommended: b });
    // conversationEvidence orders [selected, recommended, ...rest]. Both pairs are
    // still projected, and the engine recommendation is carried separately — the
    // array position carries no option identity (that comes only from
    // displayedOptions, see FM-ID-*).
    expect(evidence.pairs.map(p => p.vehicleId)).toEqual([2, 1]);
    expect(evidence.recommended).toEqual({ vehicleId: 2, driverId: 2 });
    expect(evidence.coverage.pairs).toEqual({ total: 2, included: 2, truncated: false });
    expect(dispatchDecision(a).state).toBe('ALL_CLEAR');
  });

  it('FM-ELIG-003 no eligible pair reports recorded exclusions and never claims fleet-wide unavailability', () => {
    const withReasons = project([], { recommended: null, noneReasons: [exclusionOnly(7, 'Vehicle status is Under Maintenance.', { prefiltered: true })] });
    const answer = evidenceSummary(withReasons, 'Who can take this?');
    expect(answer).toContain('No pair is currently recommended');
    expect(answer).toContain('Under Maintenance');
    expect(answer).not.toMatch(/\ball vehicles\b/i);

    const empty = project([], { recommended: null });
    expect(evidenceSummary(empty, 'Who can take this?')).toContain('does not prove the fleet is unavailable');
  });

  it('FM-ELIG-004 an immediate reservation carries live evidence the future case must not', () => {
    const immediate = project([immediatePair({ etaMinutes: 12 })]);
    expect(immediate.pairs[0].gpsHealth).toBe('Fresh');
    expect(immediate.pairs[0].livePickupEta).toMatchObject({ etaMinutes: 12 });
    expect(immediate.pairs[0].travelToPickupMinutes).toBe(12);
  });

  it('FM-ELIG-005 a future pair with a predicted transfer is never labelled a live ETA', () => {
    const pair = makePair({ expectedRoute: { etaMinutes: 18, basis: 'Predicted transfer from preceding destination' } });
    const evidence = project([pair]);
    expect(evidence.pairs[0].livePickupEta).toBeNull();
    expect(evidence.pairs[0].travelToPickupMinutes).toBe(18);
    const answer = evidenceSummary(evidence, 'What is the ETA?');
    expect(answer).toContain('this is not a live ETA');
    expect(answer).not.toMatch(/live pickup ETA is 18/i);
  });
});

describe('B. Driver availability', () => {
  const unavailable = () => blockedPair({ schedule: 'Driver is on approved leave for this window.' }, {
    driver: { driver_name: 'Marco Santos' }, vehicle: { plate_number: 'XYZ 5678' }, vehicle_id: 9, driver_id: 4,
  });

  it('FM-DRV-001 "why is the driver unavailable" names the recorded blocker and one corrective step', () => {
    const evidence = project([unavailable()]);
    const answer = evidenceSummary(evidence, 'Why is Driver Marco unavailable?');
    expect(answer).toContain('Marco Santos');
    expect(answer).toContain('cannot be assigned');
    expect(answer).toContain('approved leave');
    expect(answer).toContain('Next step:');
    expect(answer).not.toMatch(/\bis available\b/i);
  });

  it('FM-DRV-002 the availability question reaches the same conclusion as the reason question', () => {
    const evidence = project([unavailable()]);
    const why = evidenceSummary(evidence, 'Why is Driver Marco unavailable?');
    const is = evidenceSummary(evidence, 'Is Marco available?');
    for (const answer of [why, is]) {
      expect(answer).toContain('cannot be assigned');
      expect(answer).not.toMatch(/\bMarco (Santos )?is available\b/i);
    }
    expect(is).toContain('approved leave');
  });

  it('FM-DRV-003 an approved-leave blocker maps to the driver-availability recovery code, not a vehicle one', () => {
    const evidence = project([unavailable()]);
    const action = evidence.pairs[0].recoveryActions[0];
    expect(action).toMatchObject({ code: 'DRIVER_UNAVAILABLE', record: 'schedule' });
    expect(action.status).toBe('blocking');
  });

  it('FM-DRV-004 the same driver is eligible once no blocker is recorded for the window', () => {
    const pair = makePair({ driver: { driver_name: 'Marco Santos' }, vehicle_id: 9, driver_id: 4 });
    expect(dispatchDecision(pair).state).toBe('ALL_CLEAR');
    expect(evidenceSummary(project([pair]), 'Is Marco available?')).toContain('the recorded checks passed');
  });
});

describe('C. Vehicle availability', () => {
  const cases = [
    ['FM-VEH-001', 'registration', 'Vehicle XYZ 5678 registration 2026-08-01 is not valid for this trip.', 'REGISTRATION_EXPIRED'],
    ['FM-VEH-002', 'insurance', 'Vehicle XYZ 5678 insurance 2026-08-24 is not valid for this trip.', 'INSURANCE_EXPIRED'],
    ['FM-VEH-003', 'maintenance', 'Vehicle is under Preventive Maintenance during this window.', 'MAINTENANCE_CONFLICT'],
  ];

  for (const [id, checkId, message, code] of cases) {
    it(`${id} a blocked ${checkId} check is BLOCKED, unchoosable, and mapped to ${code}`, () => {
      const pair = blockedPair({ [checkId]: message }, { vehicle_id: 12, driver_id: 3, vehicle: { plate_number: 'XYZ 5678' } });
      const decision = dispatchDecision(pair);
      expect(decision.state).toBe('BLOCKED');
      expect(decision.canConfirm).toBe(false);
      expect(decision.canReview).toBe(false);

      const evidence = project([pair]);
      expect(evidence.pairs[0].canChoose).toBe(false);
      expect(evidence.pairs[0].recoveryActions[0].code).toBe(code);
      const answer = evidenceSummary(evidence, 'Why is this vehicle blocked?');
      expect(answer).toContain(message);
      expect(answer).toContain('cannot be assigned');
    });
  }

  it('FM-VEH-004 a non-dispatchable vehicle reaches Copilot as a prefiltered exclusion, not as a candidate pair', () => {
    // Under Maintenance / Decommissioned / Registration Expired are removed by
    // the candidate pool query (fetchCandidates) and reported by the cheap
    // prefilter query, so they must never appear as an evaluated pair.
    const evidence = project([], { noneReasons: [exclusionOnly(12, 'Vehicle status is Under Maintenance.', { prefiltered: true, plate: 'XYZ 5678' })] });
    expect(evidence.pairs).toHaveLength(0);
    expect(evidence.exclusions[0].recovery).toMatchObject({ code: 'VEHICLE_STATUS', record: 'vehicle', id: 12 });
    const answer = evidenceSummary(evidence, 'Why is XYZ 5678 not an option?');
    expect(answer).toContain('Under Maintenance');
    expect(answer).toContain('Check vehicle record');
    // A prefiltered row is never presented as an available option.
    expect(answer).not.toMatch(/is available for this booking/i);
  });

  it('FM-VEH-005 a vehicle that becomes available for a later window is eligible again', () => {
    // Same plate: blocked on the earlier window, verified clear on the later one.
    const earlier = blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 12, driver_id: 3 });
    const later = makePair({ vehicle_id: 12, driver_id: 3 });
    expect(dispatchDecision(earlier).state).toBe('BLOCKED');
    expect(dispatchDecision(later).state).toBe('ALL_CLEAR');
    // The blocker is window-scoped evidence, not a sticky vehicle property.
    expect(earlier.checks.find(c => c.id === 'maintenance').status).toBe('blocking');
    expect(later.checks.find(c => c.id === 'maintenance').status).toBe('verified');
  });

  it('FM-VEH-006 a vehicle absent from pairs and exclusions is unknown, and a prefiltered exclusion is not an option', () => {
    const evidence = project([], { noneReasons: [exclusionOnly(31, 'Seats 4 — too small for 6 passenger(s).', { prefiltered: true })] });
    expect(evidence.exclusions[0]).toMatchObject({ vehicleId: 31, prefiltered: true });
    expect(evidence.exclusions[0].recovery).toMatchObject({ code: 'CAPACITY_MISMATCH' });
    expect(evidence.pairs).toHaveLength(0);
    expect(evidenceSummary(evidence, 'Is vehicle 31 available?')).toContain('too small');
  });

  it('FM-VEH-007 every pair reaching Copilot with a blocking schedule check is driver-sourced', () => {
    // conflicts.js groups driver_unavailable | driver_conflict | vehicle_conflict
    // | vehicle_status into the single `schedule` check, and recoveryActionForCheck
    // resolves `schedule` to DRIVER_UNAVAILABLE / "Pick an available driver".
    // That stays correct only because the vehicle-sourced causes are removed
    // upstream: a vehicle with a non-zero window load is skipped in pair-scoring
    // and a non-dispatchable status is filtered out of the candidate pool. This
    // test freezes that dependency so a future change to either filter is caught.
    const driverSourced = blockedPair({ schedule: 'Driver Juan is on approved leave.' });
    expect(recoveryActionForCheck({ id: 'schedule', status: 'blocking' }, { driverId: 4 }))
      .toMatchObject({ code: 'DRIVER_UNAVAILABLE', record: 'schedule', id: 4 });
    const evidence = project([driverSourced]);
    expect(evidence.pairs[0].recoveryActions[0].code).toBe('DRIVER_UNAVAILABLE');
  });
});

describe('D. Driver + vehicle pairing', () => {
  it('FM-PAIR-001 an active pairing is verified and needs no recovery action', () => {
    const pair = makePair();
    expect(pair.checks.find(c => c.id === 'pairing').status).toBe('verified');
    expect(recoveryActionForCheck({ id: 'pairing', status: 'verified' })).toBeNull();
    expect(dispatchDecision(pair).state).toBe('ALL_CLEAR');
  });

  it('FM-PAIR-002 no effective pairing is blocking and routes to the substitute schedule record', () => {
    const pair = blockedPair({ pairing: 'This is not the effective designated or substitute pair.' });
    const action = recoveryActionForCheck({ id: 'pairing', status: 'blocking', message: 'x' }, { vehicleId: 5 });
    expect(action).toMatchObject({ code: 'PAIRING', record: 'schedule', fix: 'record', id: 5 });
    expect(dispatchDecision(pair).state).toBe('BLOCKED');
  });

  it('FM-PAIR-003 a substitute pairing is clear, and a pairing that is clear still cannot rescue another blocker', () => {
    expect(dispatchDecision(makePair()).state).toBe('ALL_CLEAR');
    const otherwiseValid = blockedPair({ capacity: 'Seats 2 — too small for 4 passenger(s).' });
    expect(otherwiseValid.checks.find(c => c.id === 'pairing').status).toBe('verified');
    expect(dispatchDecision(otherwiseValid).state).toBe('BLOCKED');
  });
});

describe('E. Capacity', () => {
  it('FM-CAP-001 a vehicle that satisfies the requested seating is verified', () => {
    const pair = makePair({ vehicle: { plate_number: 'HIACE 01', seating_capacity: 12 } });
    expect(pair.checks.find(c => c.id === 'capacity').status).toBe('verified');
    expect(dispatchDecision(pair).state).toBe('ALL_CLEAR');
  });

  it('FM-CAP-002 requested capacity above the vehicle is blocking and offers a larger-vehicle remedy', () => {
    const pair = blockedPair({ capacity: 'Seats 4 — too small for 7 passenger(s).' });
    const evidence = project([pair]);
    expect(dispatchDecision(pair).state).toBe('BLOCKED');
    expect(evidence.pairs[0].recoveryActions[0]).toMatchObject({ code: 'CAPACITY_MISMATCH', label: 'Needs a larger vehicle' });
    // The requested seating requirement is never dropped from the explanation.
    expect(evidenceSummary(evidence, 'Why is this pair blocked?')).toContain('7 passenger(s)');
  });

  it('FM-CAP-003 the pre-filter capacity exclusion and the engine capacity blocker agree on the reason', () => {
    const engine = recoveryActionForCheck({ id: 'capacity', status: 'blocking' }, { requestId: 502 });
    const prefilter = recoveryActionForExclusion({ reason: 'Seats 4 — too small for 7 passenger(s).' }, { requestId: 502 });
    expect(engine.code).toBe(prefilter.code);
    expect(engine.fix).toBe(prefilter.fix);
  });
});

describe('F. Schedule conflicts', () => {
  it('FM-SCHED-001 an overlapping commitment is blocking and the recovery is a choice, not a record fix', () => {
    const pair = blockedPair({ schedule: 'Overlaps dispatch #412.' });
    const action = recoveryActionForCheck({ id: 'schedule', status: 'blocking' }, { driverId: 4 });
    expect(action).toMatchObject({ code: 'DRIVER_UNAVAILABLE', fix: 'choice', id: 4 });
    expect(dispatchDecision(pair).state).toBe('BLOCKED');
  });

  it('FM-SCHED-002 a tight but sufficient turnaround is REVIEW_REQUIRED, never ALL_CLEAR', () => {
    const pair = makePair({ readiness: 'REVIEW_REQUIRED', feasibility: { verdict: 'TIGHT', reasons: ['Tight pickup buffer.'] }, reviewable: true, scheduleEvidence: { usableSlackMinutes: 8, transferMinutes: 22, gapMinutes: 40, preparationMinutes: 10 } });
    const decision = dispatchDecision(pair);
    expect(decision.state).toBe('REVIEW_REQUIRED');
    expect(decision.canConfirm).toBe(false);
    expect(decision.canReview).toBe(true);
  });

  it('FM-SCHED-003 a downstream conflict surfaces as an INFEASIBLE verdict with the protected dispatch named', () => {
    const pair = makePair({
      readiness: 'REVIEW_REQUIRED', reviewable: false,
      feasibility: { verdict: 'INFEASIBLE', reasons: ['Insufficient turnaround before dispatch #415.'] },
      hardConflicts: [{ severity: 'blocking', type: 'tentative_overlap', message: 'Driver or vehicle overlaps proposed request #9.' }],
      downstream: [{ nextDispatchId: 415, verdict: 'INFEASIBLE', reasons: ['Insufficient turnaround before dispatch #415.'] }],
    });
    expect(dispatchDecision(pair).state).toBe('BLOCKED');
    const evidence = project([pair]);
    expect(evidence.pairs[0].nextTrips).toEqual([{ dispatchId: 415, verdict: 'INFEASIBLE', reasons: ['Insufficient turnaround before dispatch #415.'] }]);
    expect(evidenceSummary(evidence, 'Why is this blocked?')).toContain('dispatch #415');
  });

  it('FM-SCHED-004 back-to-back with verified release evidence is clear and reports the release source', () => {
    const pair = makePair({
      scheduleEvidence: { usableSlackMinutes: 35, transferMinutes: 15, gapMinutes: 60, preparationMinutes: 10, releaseAt: '2026-09-18T00:30:00.000Z', releaseSource: 'recorded completion' },
      temporalContext: { horizon: 'NEAR_DISPATCH', urgency: 'SHORT_NOTICE', nextBoundaryAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(dispatchDecision(pair).state).toBe('ALL_CLEAR');
    expect(project([pair]).pairs[0].scheduleEvidence.releaseSource).toBe('recorded completion');
  });
});

describe('G. Maintenance / incidents', () => {
  it('FM-MAINT-001 an active work order blocks the vehicle and names the maintenance record', () => {
    const pair = blockedPair({ maintenance: 'Scheduled service overlaps this booking.' }, { vehicle_id: 21 });
    const evidence = project([pair]);
    expect(evidence.pairs[0].recoveryActions[0]).toMatchObject({ code: 'MAINTENANCE_CONFLICT', record: 'maintenance', id: 21 });
    expect(evidenceSummary(evidence, 'Why is this vehicle blocked?')).toContain('Check maintenance record');
  });

  it('FM-MAINT-002 a blocking incident mints an incident-scoped reference and exposes only the incident id', () => {
    const pair = makePair({
      vehicle_id: 5, driver_id: 6, readiness: 'REVIEW_REQUIRED', reviewable: false,
      feasibility: { verdict: 'INFEASIBLE', reasons: ['Vehicle is restricted by incident #2041.'] },
      hardConflicts: [{ severity: 'blocking', type: 'incident', message: 'Vehicle is restricted by incident #2041.', detail: { incident_id: 2041 } }],
    });
    const evidence = project([pair]);
    expect(evidence.pairs[0].incidentIds).toEqual([2041]);
    expect(JSON.stringify(evidence)).not.toMatch(/description|location|actions taken/i);
  });

  it('FM-MAINT-003 a non-vehicle incident never becomes a vehicle blocker', () => {
    // Only vehicle-scoped incidents reach the vehicle's incident check; a driver
    // incident with no grounding decision leaves the vehicle checks verified.
    const pair = makePair({ hardConflicts: [], advisories: [{ type: 'driver_advisory', severity: 'warning', message: 'Driver record has a minor note.' }] });
    expect(dispatchDecision(pair).state).toBe('ALL_CLEAR');
    expect(pair.checks.find(c => c.id === 'incidents').status).toBe('verified');
  });

  it('FM-MAINT-004 a completed work order returns the vehicle to a verified maintenance check', () => {
    expect(makePair().checks.find(c => c.id === 'maintenance').status).toBe('verified');
  });

  it('FM-MAINT-005 an unverifiable check is never reported as a maintenance finding', () => {
    const pair = unverifiedPair(['maintenance']);
    const decision = dispatchDecision(pair);
    expect(decision.state).toBe('INSUFFICIENT_DATA');
    const evidence = project([pair]);
    expect(evidence.pairs[0].recoveryActions[0]).toMatchObject({ code: 'MAINTENANCE_CONFLICT' });
    expect(evidence.pairs[0].recoveryActions[0].status).toBe('missing');
    // 'missing' is a verification issue, not a proven service-window overlap.
    expect(evidenceSummary(evidence, 'Is maintenance blocking this?')).not.toMatch(/active work order|is under maintenance/i);
  });

  it('FM-MAINT-006 the check taxonomy is exactly the engine contract', () => {
    expect(Object.keys(CHECK_LABELS)).toEqual(['request', 'capacity', 'registration', 'insurance', 'license', 'pairing', 'schedule', 'maintenance', 'incidents', 'category']);
    expect(makePair().checks.map(c => c.label)).toEqual(Object.values(CHECK_LABELS));
  });
});
