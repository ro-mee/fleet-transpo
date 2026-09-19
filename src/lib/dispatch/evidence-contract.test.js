import { it, expect } from 'vitest';
import {
  EVIDENCE_TYPES, ACTIVE_EVIDENCE_TYPES,
  signEvidenceRef, verifyEvidenceRef, projectEvidenceFacts,
  proofTypeForRecovery, attachEvidenceProofs,
} from './evidence-contract';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-evidence';

it('round-trips a signed ref and enforces request scope', () => {
  const ref = signEvidenceRef({ requestId: 502, vehicleId: 1, proofType: EVIDENCE_TYPES.MAINTENANCE });
  expect(ref.startsWith('ev_')).toBe(true);
  expect(verifyEvidenceRef(ref, { requestId: 502 }).proofType).toBe(EVIDENCE_TYPES.MAINTENANCE);
  expect(() => verifyEvidenceRef(ref, { requestId: 999 })).toThrowError(expect.objectContaining({ code: 'SCOPE' }));
  expect(() => verifyEvidenceRef(ref.slice(0, -2) + 'xx', { requestId: 502 })).toThrow();
});

it('keeps trail reserved until its phase while comparison is active', () => {
  expect(ACTIVE_EVIDENCE_TYPES).toContain(EVIDENCE_TYPES.COMPARISON);
  expect(ACTIVE_EVIDENCE_TYPES).not.toContain(EVIDENCE_TYPES.TRAIL);
  const trail = signEvidenceRef({ requestId: 1, proofType: EVIDENCE_TYPES.TRAIL });
  expect(() => verifyEvidenceRef(trail, { requestId: 1 })).toThrowError(expect.objectContaining({ code: 'INACTIVE' }));
  const comparison = signEvidenceRef({ requestId: 1, vehicleId: 1, driverId: 2, proofType: EVIDENCE_TYPES.COMPARISON, recordId: '3:4' });
  expect(verifyEvidenceRef(comparison, { requestId: 1 }).proofType).toBe(EVIDENCE_TYPES.COMPARISON);
});

it('strips non-allowlisted fields by default', () => {
  const facts = projectEvidenceFacts(EVIDENCE_TYPES.MAINTENANCE, {
    plate: 'ABC', status: 'In Progress', description: 'private', cost: 99, remarks: 'x',
  });
  expect(facts).toEqual({ plate: 'ABC', status: 'In Progress' });
  expect(projectEvidenceFacts(EVIDENCE_TYPES.LEAVE, { status: 'Approved', reason: 'private' })).toEqual({ status: 'Approved' });
});

it('maps recovery codes to proof types without inventing new ones', () => {
  expect(proofTypeForRecovery({ code: 'MAINTENANCE_CONFLICT' })).toBe(EVIDENCE_TYPES.MAINTENANCE);
  expect(proofTypeForRecovery({ code: 'INSURANCE_EXPIRED' })).toBe(EVIDENCE_TYPES.COMPLIANCE);
  expect(proofTypeForRecovery({ code: 'CAPACITY_MISMATCH' })).toBe(EVIDENCE_TYPES.CAPACITY);
  expect(proofTypeForRecovery({ code: 'PAIRING' })).toBe(EVIDENCE_TYPES.PAIRING);
  expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', hint: 'on approved leave' })).toBe(EVIDENCE_TYPES.LEAVE);
  expect(proofTypeForRecovery({ code: 'DRIVER_UNAVAILABLE', hint: 'overlaps' })).toBe(EVIDENCE_TYPES.SCHEDULE_CONFLICT);
  expect(proofTypeForRecovery({ code: 'UVVRP_RESTRICTED' })).toBe(EVIDENCE_TYPES.VEHICLE_STATUS);
  expect(proofTypeForRecovery({ code: 'UNKNOWN' })).toBeNull();
  expect(proofTypeForRecovery({ code: 'REQUEST_EVIDENCE' })).toBeNull();
});

it('attaches signed refs to pair and exclusion recovery actions', () => {
  const evidence = {
    pairs: [{ vehicleId: 1, driverId: 2, recoveryActions: [{ code: 'MAINTENANCE_CONFLICT', record: 'maintenance', id: 1, vehicleId: 1 }] }],
    exclusions: [{ vehicleId: 1, recovery: { code: 'VEHICLE_STATUS', record: 'vehicle', id: 1, vehicleId: 1 } }],
    recoveryActions: [{ code: 'UNKNOWN', record: 'request', id: 502 }],
  };
  attachEvidenceProofs(evidence, 502);
  expect(evidence.pairs[0].recoveryActions[0].proof.type).toBe(EVIDENCE_TYPES.MAINTENANCE);
  expect(verifyEvidenceRef(evidence.pairs[0].recoveryActions[0].proof.ref, { requestId: 502 }).requestId).toBe(502);
  expect(evidence.exclusions[0].recovery.proof.type).toBe(EVIDENCE_TYPES.VEHICLE_STATUS);
  expect(evidence.recoveryActions[0].proof).toBeNull();
});

it('mints incident refs for incident blockers instead of generic vehicle proof', () => {
  const evidence = {
    pairs: [{
      vehicleId: 5, driverId: 6, incidentIds: [2041],
      recoveryActions: [{ code: 'VEHICLE_STATUS', record: 'vehicle', id: 5, vehicleId: 5, message: 'Vehicle is restricted by incident #2041.' }],
    }],
  };
  attachEvidenceProofs(evidence, 502);
  const proof = evidence.pairs[0].recoveryActions[0].proof;
  expect(proof.type).toBe(EVIDENCE_TYPES.INCIDENT);
  const ref = verifyEvidenceRef(proof.ref, { requestId: 502 });
  expect(ref.recordId).toBe(2041);
});
