import { describe, expect, it } from 'vitest';
import { comparePairEvidence, rankDispatchPairs, pairIdentity } from './recommendation-ranking';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';
import { conversationEvidence, evidenceSummary } from './conversation';
import { dispatchDecision } from './decision';
import { makePair, blockedPair, unverifiedPair, makeRequest, makeRecommendation } from './fleetmate-fixtures';

// Group J of the FleetMate scenario matrix: the ranking hierarchy the Copilot is
// allowed to narrate. The comparator decides; FleetMate explains. Nothing here
// invents a criterion — every expectation is the verified behaviour of
// recommendation-ranking.js against the configured policy.

const POLICY = DEFAULT_DISPATCH_POLICY; // efficiencyTieMinutes: 10

/** A clean SAFE pair, band 0, differing only in the fields a scenario names. */
const ranked = (vehicle_id, over = {}) => makePair({ vehicle_id, driver_id: vehicle_id, ...over });
const order = (a, b) => comparePairEvidence(a, b, POLICY);

describe('J. Ranking hierarchy', () => {
  it('FM-RANK-001 an unassignable pair is ranked below a confirmable one, however fast it travels', () => {
    const blocked = blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, {
      vehicle_id: 1, driver_id: 1, scheduleEvidence: { usableSlackMinutes: 90, transferMinutes: 2, gapMinutes: 120, preparationMinutes: 10 },
    });
    const clear = ranked(2, { scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 45, gapMinutes: 80, preparationMinutes: 10 } });
    expect(order(clear, blocked).code).toBe('RELIABILITY');
    // Lower order sorts first, and the ranked list puts the eligible pair first.
    const rankedList = rankDispatchPairs([blocked, clear], POLICY);
    expect(rankedList.map(p => p.vehicle_id)).toEqual([2, 1]);
    expect(rankedList[0].decisionEvidence.code).toBe('RELIABILITY');
    expect(rankedList[1].decisionEvidence.label).toBe('Alternative');
  });

  it('FM-RANK-002 reliability outranks efficiency: a tight but sufficient pair beats a faster unverified one', () => {
    const tight = ranked(1, { feasibility: { verdict: 'TIGHT', reasons: ['Tight pickup buffer.'] }, scheduleEvidence: { usableSlackMinutes: 8, transferMinutes: 40, gapMinutes: 40, preparationMinutes: 10 } });
    const unverified = unverifiedPair([], { vehicle_id: 2, driver_id: 2, scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 5, gapMinutes: 80, preparationMinutes: 10 } });
    expect(order(tight, unverified)).toMatchObject({ code: 'RELIABILITY' });
    expect(rankDispatchPairs([unverified, tight], POLICY).map(p => p.vehicle_id)).toEqual([1, 2]);
  });

  it('FM-RANK-003 only a material transfer difference claims a material advantage', () => {
    const base = { scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 } };
    const slower = ranked(1, base);
    const atPolicyEdge = order(ranked(2, { scheduleEvidence: { ...base.scheduleEvidence, transferMinutes: 10 + POLICY.efficiencyTieMinutes } }), slower);
    expect(atPolicyEdge.code).toBe('EFFICIENCY');
    // At the policy tie threshold the difference is not material, so the claim
    // is only a tie-break — never "materially less travel".
    expect(atPolicyEdge.explanation).toContain('breaks the tie');
    expect(atPolicyEdge.explanation).not.toContain('materially less');

    const beyond = order(ranked(3, { scheduleEvidence: { ...base.scheduleEvidence, transferMinutes: 10 + POLICY.efficiencyTieMinutes + 1 } }), slower);
    expect(beyond.explanation).toContain('materially less');
    expect(beyond.order).toBe(POLICY.efficiencyTieMinutes + 1);
  });

  it('FM-RANK-004 a non-material transfer difference yields to workload between equally clean pairs', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    // vehicle 1 travels 5 minutes longer (below the 10-minute policy tie) and
    // carries the lighter service-date load, so workload decides.
    const lighter = ranked(1, { scheduleEvidence: { ...slack, transferMinutes: 15 }, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 1, scheduledTrips: 1, completedTrips: 0, activeTrips: 0 } });
    const heavier = ranked(2, { scheduleEvidence: slack, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 4, scheduledTrips: 4, completedTrips: 0, activeTrips: 0 } });
    const comparison = order(lighter, heavier);
    expect(comparison.code).toBe('WORKLOAD');
    expect(comparison.order).toBe(-3);
    expect(comparison.explanation).toContain('lighter recorded service-date workload');
  });

  it('FM-RANK-005 workload never decides between different service dates', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    const a = ranked(5, { scheduleEvidence: slack, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 6 } });
    const b = ranked(2, { scheduleEvidence: slack, workloadEvidence: { complete: true, serviceDate: '2026-09-19', totalTrips: 0 } });
    // Cross-date loads are not comparable, so the tie falls to standing/id.
    expect(order(a, b)).toMatchObject({ code: 'SCHEDULE_FIT' });
    expect(rankDispatchPairs([a, b], POLICY).map(p => p.vehicle_id)).toEqual([2, 5]);
  });

  it('FM-RANK-006 a lighter workload never overturns a reliability difference', () => {
    const lighter = ranked(1, { feasibility: { verdict: 'TIGHT', reasons: ['Tight pickup buffer.'] }, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 0 } });
    const heavier = ranked(2, { workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 9 } });
    expect(order(lighter, heavier).code).toBe('RELIABILITY');
    expect(rankDispatchPairs([lighter, heavier], POLICY).map(p => p.vehicle_id)).toEqual([2, 1]);
  });

  it('FM-RANK-007 incomplete workload evidence is not treated as a lighter load', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    const unknown = ranked(1, { scheduleEvidence: slack, workloadEvidence: { complete: false, serviceDate: '2026-09-18', totalTrips: 0 } });
    const known = ranked(2, { scheduleEvidence: slack, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 5 } });
    // Both are clean SAFE pairs on one date, but only one has a complete load —
    // so the tie falls through to standing/id rather than crediting "0 trips".
    expect(order(unknown, known).code).toBe('SCHEDULE_FIT');
    expect(rankDispatchPairs([unknown, known], POLICY).map(p => p.vehicle_id)).toEqual([1, 2]);
  });

  it('FM-RANK-008 an existing standing preference outranks a lower vehicle id', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    const substitute = ranked(5, { scheduleEvidence: slack, reason_type: 'substitute' });
    const designated = ranked(9, { scheduleEvidence: slack, reason_type: 'designated' });
    expect(order(substitute, designated)).toMatchObject({ code: 'SCHEDULE_FIT', order: 1 });
    expect(rankDispatchPairs([substitute, designated], POLICY).map(p => p.vehicle_id)).toEqual([9, 5]);
  });

  it('FM-RANK-009 the final tiebreak is stable and deterministic', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    const pairs = [ranked(3, { scheduleEvidence: slack }), ranked(1, { scheduleEvidence: slack }), ranked(2, { scheduleEvidence: slack })];
    expect(rankDispatchPairs(pairs, POLICY).map(p => p.vehicle_id)).toEqual([1, 2, 3]);
    // Re-ranking the same evidence never reshuffles it.
    expect(rankDispatchPairs(pairs, POLICY).map(p => p.vehicle_id)).toEqual([1, 2, 3]);
    expect(pairIdentity(pairs[0])).toBe(`1:1`);
  });

  it('FM-RANK-009b explains an unverified tie without inventing a timing advantage', () => {
    const pending = { feasibility: { verdict: 'SAFE' }, readiness: 'PENDING', checks: [{ status: 'verified' }] };
    const ordered = rankDispatchPairs([ranked(2, pending), ranked(5, pending)], POLICY);
    expect(ordered[0].decisionEvidence.explanation).toContain('stable tie-breaker');
    expect(ordered[0].decisionEvidence.explanation).not.toMatch(/stronger timing|more preparation/i);
  });

  it('FM-RANK-010 a single evaluated option is named as such, with no comparison it cannot support', () => {
    const [only] = rankDispatchPairs([ranked(7)], POLICY);
    expect(only.decisionEvidence).toMatchObject({ code: 'ONLY_OPTION', label: 'Only evaluated option', comparedPair: null, alternativeAdvantage: null });
    expect(only.reasons).toEqual([only.decisionEvidence.explanation]);
    // The label and the explanation are both honest about there being nothing to
    // compare: a lone option is told it has no counterpart rather than invited to
    // compare against one that does not exist, and no relative claim is made.
    expect(only.decisionEvidence.explanation).toBe('This is the only evaluated option, so there is nothing to compare it against.');
    expect(JSON.stringify(only.decisionEvidence)).not.toMatch(/better than|Option 2|other option/i);
  });

  it('FM-RANK-011 GPS health is not a ranking input', () => {
    const slack = { usableSlackMinutes: 60, transferMinutes: 10, gapMinutes: 80, preparationMinutes: 10 };
    const live = ranked(3, { scheduleEvidence: slack, dispatchContext: { mode: 'IMMEDIATE', liveLocationUsed: true, reasonCode: 'PICKUP_WITHIN_HORIZON', gpsHealth: 'Fresh' } });
    const offline = ranked(1, { scheduleEvidence: slack, dispatchContext: { mode: 'IMMEDIATE', liveLocationUsed: false, reasonCode: 'PICKUP_WITHIN_HORIZON', gpsHealth: 'Offline' } });
    // Identical evidence except health and id: the id decides, so health moved nothing.
    expect(order(live, offline).code).toBe('SCHEDULE_FIT');
    expect(rankDispatchPairs([live, offline], POLICY).map(p => p.vehicle_id)).toEqual([1, 3]);
  });

  it('FM-RANK-012 a caveated or unverified pair is demoted below a clean SAFE pair', () => {
    const caveated = ranked(1, { advisories: [{ severity: 'warning', type: 'vehicle_advisory', message: 'Registration expires soon.' }] });
    const unverifiedReadiness = ranked(4, { readiness: 'REVIEW_REQUIRED' });
    const clean = ranked(9);
    expect(order(clean, caveated).code).toBe('RELIABILITY');
    expect(order(clean, unverifiedReadiness).code).toBe('RELIABILITY');
    expect(rankDispatchPairs([caveated, unverifiedReadiness, clean], POLICY)[0].vehicle_id).toBe(9);
  });

  it('FM-RANK-013 the narrator is handed the engine order, never asked to reproduce it', () => {
    const clear = ranked(4, { vehicle: { plate_number: 'CLEAR 04' }, driver: { driver_name: 'Ana Reyes' } });
    const blocked = blockedPair({ capacity: 'Seats 4 — too small for 7 passenger(s).' }, { vehicle_id: 2, driver_id: 2, vehicle: { plate_number: 'SMALL 02' } });
    const ordered = rankDispatchPairs([blocked, clear], POLICY);
    // The engine order becomes the recommendation the Copilot narrates.
    const evidence = conversationEvidence(makeRequest(), makeRecommendation({ candidates: ordered, recommended: ordered[0] }));
    expect(evidence.recommended).toEqual({ vehicleId: 4, driverId: 4 });
    // Position carries salience only; identity comes from displayedOptions, which
    // the route attaches. The projection must still expose both pairs' states.
    expect(evidence.pairs.map(p => p.state)).toEqual(['ALL_CLEAR', 'BLOCKED']);
    expect(dispatchDecision(ordered[0]).canConfirm).toBe(true);
    expect(dispatchDecision(ordered[1]).canConfirm).toBe(false);
    expect(evidence.pairs[1].recoveryActions[0]).toMatchObject({ code: 'CAPACITY_MISMATCH' });
    // The blocked pair is never described as choosable.
    expect(evidence.pairs[1].canChoose).toBe(false);
    expect(evidenceSummary(evidence, 'Why is SMALL 02 blocked?')).toContain('too small');
  });
});
