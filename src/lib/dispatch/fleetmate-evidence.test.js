import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  EVIDENCE_TYPES, EVIDENCE_ALLOWLISTS, ACTIVE_EVIDENCE_TYPES,
  verifyEvidenceRef, signEvidenceRef, projectEvidenceFacts, proofTypeForRecovery, proofTypeForCheck,
  attachEvidenceProofs, attachClearanceProofs, MANAGING_MODULE, EVIDENCE_TITLES,
} from './evidence-contract';
import { resolveComparison, resolveEvidence } from '@/services/evidence-resolve.service';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';
import { comparePairEvidence } from './recommendation-ranking';
import { conversationEvidence, evidenceSummary } from './conversation';
import { makePair, blockedPair, unverifiedPair, makeRequest, makeRecommendation } from './fleetmate-fixtures';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-evidence';

// Group K of the FleetMate scenario matrix: what the Copilot says must be the
// same thing the Evidence Drawer can prove. Every assertion here checks an
// AGREEMENT between the chat projection and the signed proof surface, or the
// default-deny boundary between them.

const REQUEST_ID = 502;
const request = () => makeRequest();
const project = (pairs, opts = {}) => conversationEvidence(request(), makeRecommendation({ candidates: pairs, ...opts }));

/** Attach proofs the way the conversation route does, then return the evidence. */
const proved = (pairs, opts = {}) => attachEvidenceProofs(attachClearanceProofs(project(pairs, opts), REQUEST_ID), REQUEST_ID);

/**
 * A { query } store standing in for the resolvers' SQL. Each statement is matched
 * by shape so a test can assert both the facts a proof returns AND the parameters
 * it queried with — the second is what catches an identity sent to the wrong
 * record. Pass `calls` to record them.
 */
const RESOLVER_SQL = {
  assignments: /driver_vehicle_assignments/,
  substitutes: /substitute_vehicle_schedules/,
  leave: /driver_leave_requests/,
  license: /SELECT license_expiry FROM drivers/,
  driverName: /JOIN employees/,
  vehicle: /FROM vehicles WHERE vehicle_id/,
};
const storeFor = ({ license_expiry = '2030-01-01', registration_expiry = '2030-01-01', insurance_expiry = '2030-01-01' } = {}, calls = null) => ({
  query: async (sql, params) => {
    calls?.push([sql, params]);
    if (RESOLVER_SQL.assignments.test(sql) || RESOLVER_SQL.substitutes.test(sql)) return { rows: [] };
    if (RESOLVER_SQL.driverName.test(sql)) return { rows: [{ name: 'Ana Reyes' }] };
    if (RESOLVER_SQL.license.test(sql)) return { rows: [{ license_expiry }] };
    if (RESOLVER_SQL.vehicle.test(sql)) return { rows: [{ plate_number: 'ABC 1234', registration_expiry, insurance_expiry }] };
    return { rows: [] };
  },
});

describe('K. Evidence agreement between chat and drawer', () => {
  it('FM-EVID-001 every pair recovery action carries a proof the drawer can resolve, scoped to this request', () => {
    const evidence = proved([blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 21, driver_id: 3 })]);
    const [action] = evidence.pairs[0].recoveryActions;
    expect(action.code).toBe('MAINTENANCE_CONFLICT');
    expect(action.proof.type).toBe(proofTypeForRecovery(action));
    expect(action.proof.type).toBe(EVIDENCE_TYPES.MAINTENANCE);
    // The ref opens only against the request it was minted for.
    expect(verifyEvidenceRef(action.proof.ref, { requestId: REQUEST_ID }).requestId).toBe(REQUEST_ID);
    expect(() => verifyEvidenceRef(action.proof.ref, { requestId: 999 })).toThrowError(expect.objectContaining({ code: 'SCOPE' }));
    expect(EVIDENCE_TITLES[action.proof.type]).toBe('Maintenance Evidence');
    expect(MANAGING_MODULE[action.proof.type]).toBe('Fleet Management');
    expect(ACTIVE_EVIDENCE_TYPES).toContain(action.proof.type);
  });

  it('FM-EVID-002 the record the chat names is the record the proof resolves to', () => {
    // Maintenance: the drawer must open the same vehicle's work order the chat implicated.
    const maintenance = proved([blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 21, driver_id: 3 })]);
    const mRef = verifyEvidenceRef(maintenance.pairs[0].recoveryActions[0].proof.ref, { requestId: REQUEST_ID });
    expect(mRef).toMatchObject({ vehicleId: 21, proofType: EVIDENCE_TYPES.MAINTENANCE, recordId: 21 });

    // Incident: the chat exposes the incident id, and the proof is incident-scoped to it.
    const incident = proved([makePair({
      vehicle_id: 5, driver_id: 6, readiness: 'REVIEW_REQUIRED', reviewable: false,
      feasibility: { verdict: 'INFEASIBLE', reasons: ['Vehicle is restricted by incident #2041.'] },
      hardConflicts: [{ severity: 'blocking', type: 'incident', message: 'Vehicle is restricted by incident #2041.', detail: { incident_id: 2041 } }],
      checks: makePair().checks.map(c => c.id === 'incidents' ? { ...c, status: 'blocking', message: 'Vehicle is restricted by incident #2041.' } : c),
    })]);
    expect(incident.pairs[0].incidentIds).toEqual([2041]);
    const iRef = verifyEvidenceRef(incident.pairs[0].recoveryActions[0].proof.ref, { requestId: REQUEST_ID });
    expect(iRef).toMatchObject({ proofType: EVIDENCE_TYPES.INCIDENT, recordId: 2041 });
  });

  it('FM-EVID-012 a leave-sourced driver block opens leave evidence, not a schedule-overlap proof', () => {
    // A driver block whose recorded reason is approved leave must open leave
    // evidence, because the alternative family resolves a different record set
    // (overlapping dispatchschedules) that can legitimately come back "clear" —
    // a drawer proving the opposite of the chat.
    const leave = proved([blockedPair({ schedule: 'Driver is on approved leave during this time.' }, { vehicle_id: 4, driver_id: 4 })]);
    const action = leave.pairs[0].recoveryActions[0];
    expect(action.code).toBe('DRIVER_UNAVAILABLE');
    expect(action.message).toContain('approved leave');
    const ref = verifyEvidenceRef(action.proof.ref, { requestId: REQUEST_ID });
    expect(ref).toMatchObject({ proofType: EVIDENCE_TYPES.LEAVE, driverId: 4, recordId: 4 });
    // Leave is the family the drawer's leave snapshot belongs to, never the
    // schedule-overlap one.
    expect(ref.proofType).not.toBe(EVIDENCE_TYPES.SCHEDULE_CONFLICT);
    expect(MANAGING_MODULE[ref.proofType]).toBe('Attendance & Leave');
  });

  it('FM-EVID-013 the recorded reason decides the evidence family, not the static template', () => {
    // recoveryForCheckId() hands every DRIVER_UNAVAILABLE action the same hint —
    // a static template that never reflects which record blocked the pair — while
    // the recorded reason lives in the check's message. Classification reads the
    // message first and falls back to the hint, which is the only carrier an
    // exclusion action has (it is built from a reason string, not a check).
    const template = 'This driver is unavailable for the window; choose an available driver.';
    expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', message: 'Driver is on approved leave during this time.', hint: template })).toBe(EVIDENCE_TYPES.LEAVE);
    expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', message: 'Rest day (Monday).', hint: template })).toBe(EVIDENCE_TYPES.SCHEDULE_CONFLICT);
    expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', hint: 'Driver is on approved leave during this time.' })).toBe(EVIDENCE_TYPES.LEAVE);
    expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', hint: 'Outside work shift (08:00–17:00).' })).toBe(EVIDENCE_TYPES.SCHEDULE_CONFLICT);

    // End to end: a schedule block that is not leave stays in the schedule
    // family, so the two are told apart by the reason rather than collapsing
    // into one family for every driver block.
    const restDay = proved([blockedPair({ schedule: 'Rest day (Monday).' }, { vehicle_id: 4, driver_id: 4 })]);
    const action = restDay.pairs[0].recoveryActions[0];
    expect(action.hint).not.toMatch(/leave/i);
    expect(action.message).toMatch(/rest day/i);
    expect(verifyEvidenceRef(action.proof.ref, { requestId: REQUEST_ID }))
      .toMatchObject({ proofType: EVIDENCE_TYPES.SCHEDULE_CONFLICT, driverId: 4 });
  });

  it('FM-EVID-014 a driver-sourced proof is never minted without a driver identity', () => {
    // An engine exclusion carries a reason string and a vehicle id but no driver
    // (dispatch-radar pushes an INFEASIBLE pair's reasons into none_reasons as
    // {vehicle_id, reason}), so recoveryActionForExclusion leaves `id: null`.
    // Minting a proof for a driver-sourced block anyway resolves some other
    // identity's records and comes back clear — leave matches no row at all,
    // schedule_conflict narrows to a vehicle-only check, and compliance reports
    // the vehicle's registration/insurance for a licence problem. Each is a
    // drawer clearing a driver the chat just said is blocked, so the ref is
    // withheld and the row renders with its reason and no Review action.
    const exclusions = [
      ['Driver is on approved leave during this time.', 'DRIVER_UNAVAILABLE', EVIDENCE_TYPES.LEAVE],
      ['Outside work shift (08:00-17:00).', 'DRIVER_UNAVAILABLE', EVIDENCE_TYPES.SCHEDULE_CONFLICT],
      ['Driver license is expired.', 'LICENSE_EXPIRED', EVIDENCE_TYPES.COMPLIANCE],
    ];
    for (const [reason, code, proofType] of exclusions) {
      const evidence = proved([], { noneReasons: [{ vehicle_id: 9, plate: 'NOP 009', reason }] });
      const recovery = evidence.exclusions[0].recovery;
      // The family is still classified correctly — only the ref is withheld.
      expect(recovery.code).toBe(code);
      expect(proofTypeForRecovery(recovery)).toBe(proofType);
      expect(recovery.proof).toBeNull();
      expect(recovery.id).toBeNull();
      // The row-level action is the same object, so it carries no proof either.
      expect(evidence.recoveryActions[0].proof).toBeNull();
    }

    // On a PAIR the driver is known, so the same reasons still mint their proof
    // scoped to the driver — identity decides, not the wording or the family.
    // `recordId` is per family: the driver's record for leave and for a licence,
    // the vehicle's for the schedule-overlap check.
    const pairs = [
      ['schedule', 'Driver is on approved leave during this time.', EVIDENCE_TYPES.LEAVE, { recordId: 6 }],
      ['schedule', 'Rest day (Monday).', EVIDENCE_TYPES.SCHEDULE_CONFLICT, { recordId: 9 }],
      ['license', 'Driver license is expired.', EVIDENCE_TYPES.COMPLIANCE, { recordId: 6, subject: 'driver' }],
    ];
    for (const [check, message, proofType, extra] of pairs) {
      const evidence = proved([blockedPair({ [check]: message }, { vehicle_id: 9, driver_id: 6 })]);
      const action = evidence.pairs[0].recoveryActions[0];
      expect(action.proof.type).toBe(proofType);
      // The driver, never the vehicle: 9 and 6 are deliberately different here.
      expect(verifyEvidenceRef(action.proof.ref, { requestId: REQUEST_ID }))
        .toMatchObject({ proofType, driverId: 6, vehicleId: 9, ...extra });
    }
  });

  it('FM-EVID-003 every verified check has a clearance proof, and a blocking check has none to show', () => {
    const evidence = proved([blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 21, driver_id: 3 })]);
    const pair = evidence.pairs[0];
    const byId = Object.fromEntries(pair.clearance.map(c => [c.checkId, c]));
    // Blocked check: the drawer must not offer a clearance snapshot for it.
    expect(byId.maintenance).toMatchObject({ status: 'blocking', proof: null });
    // Verified checks resolve to the proof type the drawer knows.
    for (const id of ['capacity', 'registration', 'insurance', 'license', 'pairing']) {
      expect(byId[id].status).toBe('verified');
      expect(byId[id].proof.type).toBe(proofTypeForCheck(id));
    }
    // A missing check renders without proof rather than as a blocker.
    const unverified = proved([unverifiedPair(['maintenance'])]);
    expect(unverified.pairs[0].clearance.find(c => c.checkId === 'maintenance')).toMatchObject({ status: 'missing', proof: null });
  });

  it('FM-EVID-004 the schedule check also mints a separate leave clearance row', () => {
    const evidence = proved([makePair({ vehicle_id: 4, driver_id: 4 })]);
    const leave = evidence.pairs[0].clearance.find(c => c.checkId === 'leave');
    expect(leave).toMatchObject({ label: 'Leave', status: 'verified' });
    expect(verifyEvidenceRef(leave.proof.ref, { requestId: REQUEST_ID })).toMatchObject({ proofType: EVIDENCE_TYPES.LEAVE, driverId: 4 });
    // The clearance row is a separate proof from the schedule-conflict one.
    const schedule = evidence.pairs[0].clearance.find(c => c.checkId === 'schedule');
    expect(schedule.proof.type).toBe(EVIDENCE_TYPES.SCHEDULE_CONFLICT);
    expect(schedule.proof.ref).not.toBe(leave.proof.ref);
  });

  it('FM-EVID-005 the clearance metadata carries only what the inspector needs, and no raw records', () => {
    const evidence = proved([makePair({ vehicle_id: 4, driver_id: 4, vehicle: { plate_number: 'ABC 1234' }, driver: { driver_name: 'Ana Reyes' } })]);
    // Labels and identity only: the horizon band, the dispatch mode (a separate
    // taxonomy the inspector needs to tell "not applicable" from "unknown"),
    // the GPS health label, and the pair's own names.
    expect(evidence.pairs[0].clearanceMeta).toEqual({
      horizon: 'FUTURE', mode: 'SCHEDULED', gpsHealth: null, driverId: 4, vehicleId: 4,
      plate: 'ABC 1234', driverName: 'Ana Reyes',
    });
    expect(JSON.stringify(evidence)).not.toMatch(/latitude|longitude|license_number|special_requests|guest/i);
    // The raw dispatch context is not carried: the mode is projected as a label
    // and its siblings (origin, previous dispatch, standby position) never are.
    expect(JSON.stringify(evidence)).not.toMatch(/originType|previousDispatchId|liveLocationUsed|originLabel/);
  });

  it('FM-EVID-006 default-deny holds for positive evidence too: unknown and private columns never leave', () => {
    for (const [type, allowed] of Object.entries(EVIDENCE_ALLOWLISTS)) {
      const projected = projectEvidenceFacts(type, {
        plate: 'ABC', status: 'Approved', verdict: 'clear', driverName: 'Ana Reyes',
        description: 'Guest had a medical emergency', remarks: 'internal note', cost: 4200,
        reason: 'personal', licenseNumber: 'N01-23-456789', latitude: 14.5995, longitude: 120.9842,
        guestName: 'Private Guest', standby_latitude: 14.5, history: [{ id: 1 }], items: [{ field: 'insurance' }],
      });
      expect(Object.keys(projected).every(k => allowed.includes(k))).toBe(true);
      expect(JSON.stringify(projected)).not.toMatch(/medial|emergency|internal note|4200|personal|N01-23|14\.5995|120\.9842|Private Guest|standby/i);
    }
    // trail has an empty allowlist, so nothing at all is displayable.
    expect(projectEvidenceFacts(EVIDENCE_TYPES.TRAIL, { plate: 'ABC', verdict: 'clear' })).toEqual({});
  });

  it('FM-EVID-007 clear evidence reports the evaluated window, never the underlying collection', () => {
    // resolveLeave's clear branch returns the evaluated window only — no history.
    const clearLeave = { verdict: 'clear', evaluatedWindow: { pickupAt: '2026-09-18T10:00:00Z', endAt: '2026-09-18T11:00:00Z' }, overlapsBooking: false, history: [{ id: 9 }], driverName: 'Ana Reyes' };
    const facts = projectEvidenceFacts(EVIDENCE_TYPES.LEAVE, clearLeave);
    expect(facts).toEqual({ driverName: 'Ana Reyes', verdict: 'clear', evaluatedWindow: clearLeave.evaluatedWindow, overlapsBooking: false });
    expect(JSON.stringify(facts)).not.toContain('history');
    // The maintenance clear branch carries no rows at all.
    expect(projectEvidenceFacts(EVIDENCE_TYPES.MAINTENANCE, { verdict: 'clear', rows: [{ description: 'x' }] })).toEqual({ verdict: 'clear' });
  });

  it('FM-EVID-008 comparison evidence names both options by code and fact, never by score or rank', async () => {
    const optionA = makePair({ vehicle_id: 1, driver_id: 1, scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 12, gapMinutes: 80, preparationMinutes: 10 }, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 4 } });
    const optionB = makePair({ vehicle_id: 3, driver_id: 3, reason_type: 'designated', scheduleEvidence: { usableSlackMinutes: 60, transferMinutes: 25, gapMinutes: 80, preparationMinutes: 10 }, workloadEvidence: { complete: true, serviceDate: '2026-09-18', totalTrips: 2 } });
    const byPair = { '1:1': optionA, '3:3': optionB };
    const facts = await resolveComparison({}, { vehicleId: 1, driverId: 1, recordId: '3:3' }, { requestRow: request() }, {
      estimateFor: async () => null,
      policyFor: async () => DEFAULT_DISPATCH_POLICY,
      evaluate: async ({ vehicleId, driverId }) => byPair[`${vehicleId}:${driverId}`],
      compare: comparePairEvidence,
    });
    expect(facts.hierarchy).toEqual(['Reliability', 'Efficiency', 'Workload when applicable', 'Standing preference']);
    expect(facts.optionA).toMatchObject({ vehicleId: 1, driverId: 1, reliability: 'SAFE', transferMinutes: 12, workload: { serviceDate: '2026-09-18', totalTrips: 4 }, standing: 'Non-standing' });
    expect(facts.optionB).toMatchObject({ vehicleId: 3, driverId: 3, reliability: 'SAFE', transferMinutes: 25, workload: { serviceDate: '2026-09-18', totalTrips: 2 }, standing: 'Standing pair' });
    // The comparison exposes the deciding code, never a score or an order value.
    expect(facts.optionA.decision).toBe('EFFICIENCY');
    const projected = projectEvidenceFacts(EVIDENCE_TYPES.COMPARISON, facts);
    expect(Object.keys(projected).sort()).toEqual(['hierarchy', 'optionA', 'optionB', 'verdict']);
    expect(JSON.stringify(projected)).not.toMatch(/score|order|points|rank|\b87\b/i);
  });

  it('FM-EVID-009 live evidence is exposed as health and timestamp only, never as a position', () => {
    const projected = projectEvidenceFacts(EVIDENCE_TYPES.GPS, { health: 'Fresh', observedAt: '2026-09-17T01:59:30Z', horizon: 'NEAR_DISPATCH', etaMinutes: 12, etaValid: true, latitude: 14.5995, longitude: 120.9842, accuracy: 12, driverId: 4 });
    expect(Object.keys(projected).sort()).toEqual(['etaMinutes', 'etaValid', 'health', 'horizon', 'observedAt']);
    expect(JSON.stringify(projected)).not.toMatch(/latitude|longitude|accuracy|14\.5995/);
  });

  it('FM-EVID-010 the chat never offers a proof type the drawer cannot resolve yet', () => {
    const evidence = proved([blockedPair({ capacity: 'Seats 4 — too small for 7 passenger(s).' }, { vehicle_id: 2, driver_id: 2 })]);
    const types = [
      ...evidence.pairs.flatMap(p => [...p.clearance.map(c => c.proof?.type), ...p.recoveryActions.map(a => a.proof?.type)]),
      ...evidence.recoveryActions.map(a => a.proof?.type),
    ].filter(Boolean);
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) expect(ACTIVE_EVIDENCE_TYPES).toContain(type);
    // Nothing in the chat surface points at the reserved trail type.
    expect(JSON.stringify(evidence)).not.toContain(EVIDENCE_TYPES.TRAIL);
  });

  it('FM-EVID-011 an exclusion action reaches the drawer with the same code the chat narrated', () => {
    const evidence = proved([], { noneReasons: [{ vehicle_id: 12, plate: 'XYZ 5678', reason: 'Vehicle status is Under Maintenance.', prefiltered: true }] });
    const exclusion = evidence.exclusions[0];
    expect(exclusion.recovery.code).toBe('VEHICLE_STATUS');
    expect(exclusion.recovery.proof.type).toBe(EVIDENCE_TYPES.VEHICLE_STATUS);
    expect(verifyEvidenceRef(exclusion.recovery.proof.ref, { requestId: REQUEST_ID })).toMatchObject({ vehicleId: 12, proofType: EVIDENCE_TYPES.VEHICLE_STATUS });
    // Chat and drawer agree on the reason text the dispatcher reads.
    expect(evidenceSummary(evidence, 'Why is XYZ 5678 not an option?')).toContain(exclusion.reason);
    expect(evidence.recoveryActions[0].code).toBe(exclusion.recovery.code);
  });

  it('FM-EVID-015 a licence proof opens the driver licence, never the vehicle documents', async () => {
    // resolveCompliance chose its branch with `vehicleId != null`, and every
    // pair-path compliance ref carries one, so a licence claim was answered from
    // the vehicle's registration/insurance — a proof whose content is unrelated
    // to the block it exists to support. The ref now states its subject and the
    // resolver obeys it. Vehicle 9 and driver 6 are deliberately different: a
    // lookup that confuses the two cannot pass by coincidence.
    const clearance = proved([makePair({ vehicle_id: 9, driver_id: 6 })]);
    const cleared = verifyEvidenceRef(clearance.pairs[0].clearance.find(c => c.checkId === 'license').proof.ref, { requestId: REQUEST_ID });
    // Both identities are present, and the subject is what decides.
    expect(cleared).toMatchObject({ proofType: EVIDENCE_TYPES.COMPLIANCE, subject: 'driver', vehicleId: 9, driverId: 6, recordId: 6 });
    const facts = await resolveEvidence(storeFor({ license_expiry: '2020-01-01' }), cleared, { bookingDate: '2026-09-18T10:00:00Z' });
    expect(facts).toMatchObject({ subject: 'driver', field: 'license', status: 'EXPIRED', verdict: 'blocked' });
    // Absence is what proves the vehicle branch did not run.
    expect(facts.subjectName).toBeUndefined();
    expect(facts.items).toEqual([{ field: 'license', expiry: '2020-01-01', status: 'EXPIRED' }]);

    // The blocking path names the driver as the record, not the vehicle the
    // action happens to be scoped to.
    const blocked = proved([blockedPair({ license: 'Driver license is expired.' }, { vehicle_id: 9, driver_id: 6 })]);
    const ref = verifyEvidenceRef(blocked.pairs[0].recoveryActions[0].proof.ref, { requestId: REQUEST_ID });
    expect(ref).toMatchObject({ subject: 'driver', vehicleId: 9, driverId: 6, recordId: 6 });
    expect(await resolveEvidence(storeFor({ license_expiry: '2020-01-01' }), ref, { bookingDate: '2026-09-18T10:00:00Z' }))
      .toMatchObject({ subject: 'driver', status: 'EXPIRED' });
  });

  it('FM-EVID-016 registration and insurance keep the vehicle as their subject', async () => {
    // The other half of the same lane: these two name the vehicle even though the
    // ref also carries the pair's driver id, so the subject decides the branch
    // rather than the presence of an id.
    const evidence = proved([makePair({ vehicle_id: 9, driver_id: 6 })]);
    for (const checkId of ['registration', 'insurance']) {
      const ref = verifyEvidenceRef(evidence.pairs[0].clearance.find(c => c.checkId === checkId).proof.ref, { requestId: REQUEST_ID });
      expect(ref).toMatchObject({ subject: 'vehicle', vehicleId: 9, recordId: 9 });
      const facts = await resolveEvidence(storeFor({ registration_expiry: '2020-01-01' }), ref, { bookingDate: '2026-09-18T10:00:00Z' });
      expect(facts).toMatchObject({ subject: 'vehicle', subjectName: 'ABC 1234', verdict: 'blocked' });
      // Both vehicle documents are reported, which is what this subject covers.
      expect(facts.items.map(i => i.field)).toEqual(['registration', 'insurance']);
    }
  });

  it('FM-EVID-017 a pairing proof looks up the pair\'s own driver, never the vehicle id in its place', async () => {
    // decision.js records a pairing block as record:'schedule' holding the VEHICLE
    // id, and `record: 'schedule'` means "the id is the driver", so the ref was
    // signed with driverId = <vehicleId>. resolvePairing then queried
    // vehicle_id=9 AND driver_id=9 and matched nothing, and resolveEvidence hung
    // the name of whichever driver shares that number on a Pairing proof, the
    // PAIRING allowlist admitting driverName. Assert the parameters, not just the
    // outcome: only the parameters show WHICH record was read.
    const evidence = proved([blockedPair({ pairing: 'No effective pairing for this vehicle and driver.' }, { vehicle_id: 9, driver_id: 6 })]);
    const action = evidence.pairs[0].recoveryActions[0];
    expect(action.code).toBe('PAIRING');
    const ref = verifyEvidenceRef(action.proof.ref, { requestId: REQUEST_ID });
    expect(ref).toMatchObject({ proofType: EVIDENCE_TYPES.PAIRING, vehicleId: 9, driverId: 6, recordId: 9 });

    const calls = [];
    const facts = await resolveEvidence(storeFor({}, calls), ref, { pickupDate: '2026-09-18' });
    const pairingCalls = calls.filter(([sql]) => RESOLVER_SQL.assignments.test(sql) || RESOLVER_SQL.substitutes.test(sql));
    expect(pairingCalls.map(([, params]) => params)).toEqual([[9, 6], [9, 6, '2026-09-18']]);
    // With no assignment and no substitute on record, the honest answer is the one
    // the chat gave.
    expect(facts).toMatchObject({ verdict: 'blocked', pairingState: 'none' });
    // The name attached is the pair's driver, resolved from the pair's own id.
    expect(facts.driverName).toBe('Ana Reyes');
  });

  it('FM-EVID-018 an unevaluated pairing reports nothing rather than "no pairing"', async () => {
    // An exclusion-sourced pairing action carries no driver (the exclusion context
    // has no driverId), so the lookup cannot be performed at all. The old
    // fallthrough ran the queries with driver_id = NULL, matched nothing, and
    // asserted pairingState:'none' — a definitive negative from a check that never
    // ran, rendered as "Pairing: none / Result: Blocking". Both facts are null,
    // which the drawer shows as "—": no claim either way.
    const evidence = proved([], { noneReasons: [{ vehicle_id: 9, plate: 'NOP 009', reason: 'No substitute or custodian pairing recorded.' }] });
    const ref = verifyEvidenceRef(evidence.exclusions[0].recovery.proof.ref, { requestId: REQUEST_ID });
    expect(ref).toMatchObject({ proofType: EVIDENCE_TYPES.PAIRING, vehicleId: 9, driverId: null });

    const calls = [];
    const facts = await resolveEvidence(storeFor({}, calls), ref, { pickupDate: '2026-09-18' });
    expect(facts.pairingState).toBeNull();
    expect(facts.verdict).toBeNull();
    expect(facts.pairingState).not.toBe('none');
    // The check asked nothing, so it answers nothing.
    expect(calls.filter(([sql]) => RESOLVER_SQL.assignments.test(sql) || RESOLVER_SQL.substitutes.test(sql))).toEqual([]);
  });

  it('FM-EVID-019 a compliance proof that cannot name its subject is refused, not guessed', async () => {
    // A ref minted before the subject field existed still verifies — but it cannot
    // say whether it covers a driver or a vehicle record, and guessing that is the
    // defect this lane removes. The store answers EVERY statement, so the refusal
    // is the resolver's decision and not an empty-result artifact.
    const ref = verifyEvidenceRef(
      signEvidenceRef({ requestId: REQUEST_ID, vehicleId: 9, driverId: 6, proofType: EVIDENCE_TYPES.COMPLIANCE }),
      { requestId: REQUEST_ID });
    expect(ref.subject).toBeNull();
    await expect(resolveEvidence(storeFor({ license_expiry: '2020-01-01', registration_expiry: '2020-01-01' }), ref, { bookingDate: '2026-09-18T10:00:00Z' }))
      .rejects.toMatchObject({ code: 'UNSCOPED' });

    // A subject the contract does not define never enters a signed payload.
    expect(() => signEvidenceRef({ requestId: REQUEST_ID, proofType: EVIDENCE_TYPES.COMPLIANCE, subject: 'booking' }))
      .toThrowError(/Invalid evidence subject/);
  });

  it('FM-EVID-020 a signed ref whose subject is not a contract value is rejected as tampered', async () => {
    // The signature covers the subject, so a ref cannot smuggle an unrecognized
    // one past the contract. Forged here with a valid MAC — signEvidenceRef
    // refuses to mint this — which is the only way to reach the verify-side guard.
    // The purpose string is duplicated from evidence-contract.js on purpose: if it
    // ever changes, this ref stops verifying and the test fails loudly.
    const payload = Buffer.from(JSON.stringify({
      v: 1, requestId: REQUEST_ID, vehicleId: 9, driverId: 6, proofType: EVIDENCE_TYPES.COMPLIANCE,
      recordId: 6, note: null, subject: 'booking', evaluatedAt: new Date().toISOString(), exp: Date.now() + 60_000,
    })).toString('base64url');
    const mac = createHmac('sha256', process.env.NEXTAUTH_SECRET)
      .update(`fleet-dispatch-evidence-v1:${payload}`).digest('base64url');
    expect(() => verifyEvidenceRef(`ev_${payload}.${mac}`, { requestId: REQUEST_ID }))
      .toThrowError(expect.objectContaining({ code: 'TAMPERED' }));
  });

  it('FM-EVID-021 a leave proof with no usable driver reports nothing, in both directions', async () => {
    // The last fail-open in the proof path. An id that is absent reaches the
    // projection through Number(), so an absent driver arrives as 0 — and 0 is the
    // dangerous shape, not null: `driver_id = 0` is a clean query that matches no
    // row, so resolveLeave's "no rows" fallthrough answered verdict:'clear'. A
    // clearance, for a driver nobody looked up, under a check the drawer shows as
    // verified. Both mint sites and the resolver now agree that an unusable
    // identity means no claim: the same null-not-'clear' rule FM-EVID-018 applies
    // to pairing, which the drawer renders as "—".
    const noDriver = proved([makePair({ vehicle_id: 4, driver_id: 0 })]);
    const leaveRow = noDriver.pairs[0].clearance.find(c => c.checkId === 'leave');
    // The row still renders, so the inspector keeps the check; it just has nothing
    // to open. The schedule clearance row beside it is unaffected.
    expect(leaveRow).toMatchObject({ label: 'Leave', status: 'verified', proof: null });
    expect(noDriver.pairs[0].clearance.find(c => c.checkId === 'schedule').proof).not.toBeNull();

    // Resolving such a ref directly — the drawer holding a proof minted before the
    // guard existed — returns no claim rather than a clearance, and asks nothing:
    // the check that cannot be performed issues no statement at all.
    const ref = verifyEvidenceRef(
      signEvidenceRef({ requestId: REQUEST_ID, vehicleId: 9, driverId: 0, proofType: EVIDENCE_TYPES.LEAVE, recordId: 0 }),
      { requestId: REQUEST_ID });
    const calls = [];
    const facts = await resolveEvidence(storeFor({}, calls), ref, { pickupAt: '2026-09-18T09:00:00Z', endAt: '2026-09-18T11:00:00Z' });
    expect(facts.verdict).toBeNull();
    expect(facts.verdict).not.toBe('clear');
    expect(facts.overlapsBooking).toBeNull();
    expect(calls.filter(([sql]) => RESOLVER_SQL.leave.test(sql))).toEqual([]);

    // The guard must not swallow the legitimate answer: a driver who was actually
    // looked up and has no overlapping leave is still reported clear.
    const real = verifyEvidenceRef(
      signEvidenceRef({ requestId: REQUEST_ID, vehicleId: 9, driverId: 4, proofType: EVIDENCE_TYPES.LEAVE, recordId: 4 }),
      { requestId: REQUEST_ID });
    const realCalls = [];
    const clear = await resolveEvidence(storeFor({}, realCalls), real, { pickupAt: '2026-09-18T09:00:00Z', endAt: '2026-09-18T11:00:00Z' });
    expect(clear).toMatchObject({ verdict: 'clear', overlapsBooking: false });
    expect(realCalls.filter(([sql]) => RESOLVER_SQL.leave.test(sql))).toHaveLength(1);

    // The recovery path applies the same predicate to a driver-sourced block. A
    // licence block carrying id 0 is the case the weaker non-null check this
    // replaced accepted: 0 is not null, so it passed, and the ref went out scoped
    // to a driver that does not exist. It is withheld now, while the same block on
    // a real driver still mints (FM-EVID-014 covers that direction).
    const blockedNoDriver = proved([blockedPair({ license: 'Driver license is expired.' }, { vehicle_id: 9, driver_id: 0 })]);
    expect(blockedNoDriver.pairs[0].recoveryActions[0].code).toBe('LICENSE_EXPIRED');
    expect(blockedNoDriver.pairs[0].recoveryActions[0].proof).toBeNull();
  });
});
