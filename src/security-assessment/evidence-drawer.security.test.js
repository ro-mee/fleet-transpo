// SEC-EVID — Evidence Drawer / signed evidence-reference security suite.
//
// Authorized assessment tests. These assert the LOCKED evidence contract:
// default-deny allowlists, HMAC-bound scope, expiration, domain separation from
// the plan/explanation tokens, and GET-only resolution. Nothing here mutates
// application state or touches the live database.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(),
  AuthError: class extends Error {
    constructor(message, status = 401) { super(message); this.status = status; }
  },
  handleError: e => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/services/reservation-lifecycle.service', () => ({
  loadRequest: vi.fn(async () => ({ request_id: 502, pickup_datetime: '2026-09-18T01:00:00+08:00', scheduled_arrival: null, passenger_count: 2 })),
}));
vi.mock('@/services/evidence-resolve.service', async importOriginal => {
  // The real resolvers are pure SQL builders; we mock the query layer instead so
  // the allowlist/projection path stays the genuine production code.
  const actual = await importOriginal();
  return { ...actual, resolveEvidence: vi.fn(async () => ({ verdict: 'clear', status: 'x' })) };
});

import { requirePermission } from '@/lib/api/utils';
import { rateLimit } from '@/lib/rate-limit';
import { resolveEvidence } from '@/services/evidence-resolve.service';
import * as evidenceRoute from '@/app/api/integration/transport-requests/[id]/evidence/route';
import { GET } from '@/app/api/integration/transport-requests/[id]/evidence/route';
import {
  EVIDENCE_TYPES, ACTIVE_EVIDENCE_TYPES, EVIDENCE_ALLOWLISTS,
  signEvidenceRef, verifyEvidenceRef, projectEvidenceFacts, proofTypeForCheck, proofTypeForRecovery,
} from '@/lib/dispatch/evidence-contract';
import { issuePlanToken, verifyPlanToken } from '@/services/dispatch-plan-evidence.service';
import { signExplanationSnapshot, verifyExplanationSnapshot } from '@/lib/dispatch/explanation';

process.env.NEXTAUTH_SECRET ??= 'sec-assessment-evidence-key';

const call = (ref, id = '502') => GET(
  new Request(`http://localhost/api/x/evidence?ref=${encodeURIComponent(ref ?? '')}`, { method: 'GET' }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
  rateLimit.mockResolvedValue({ allowed: true });
});

describe('SEC-EVID-001 — reference is HMAC-bound and immutable', () => {
  it('accepts the exact issued reference', () => {
    const ref = signEvidenceRef({ requestId: 502, vehicleId: 4, proofType: EVIDENCE_TYPES.MAINTENANCE });
    expect(verifyEvidenceRef(ref, { requestId: 502 }).proofType).toBe(EVIDENCE_TYPES.MAINTENANCE);
  });

  it('rejects a modified payload (privilege of the payload is not transferable)', () => {
    const ref = signEvidenceRef({ requestId: 502, vehicleId: 4, proofType: EVIDENCE_TYPES.LEAVE });
    const [prefix, mac] = [ref.slice(0, ref.lastIndexOf('.')), ref.slice(ref.lastIndexOf('.') + 1)];
    const forged = Buffer.from(JSON.stringify({ v: 1, requestId: 502, vehicleId: 999, driverId: 1, proofType: 'leave', recordId: 1, note: null, evaluatedAt: new Date().toISOString(), exp: Date.now() + 60000 })).toString('base64url');
    expect(() => verifyEvidenceRef(`ev_${forged}.${mac}`, { requestId: 502 })).toThrow();
    expect(prefix).toBeTruthy();
  });

  it('rejects a reference signed with a different key', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, requestId: 502, proofType: 'leave', exp: Date.now() + 60000 })).toString('base64url');
    const mac = createHmac('sha256', 'attacker-key').update(`fleet-dispatch-evidence-v1:${payload}`).digest('base64url');
    expect(() => verifyEvidenceRef(`ev_${payload}.${mac}`, { requestId: 502 })).toThrow();
  });
});

describe('SEC-EVID-002 — cross-reservation use fails closed', () => {
  it('a valid reference for reservation A is refused against reservation B (SCOPE)', () => {
    const refForA = signEvidenceRef({ requestId: 502, vehicleId: 4, proofType: EVIDENCE_TYPES.LEAVE });
    expect(() => verifyEvidenceRef(refForA, { requestId: 777 })).toThrowError(expect.objectContaining({ code: 'SCOPE' }));
  });

  it('the route answers SCOPE with 403 and never resolves the underlying record', async () => {
    const refForA = signEvidenceRef({ requestId: 502, vehicleId: 4, proofType: EVIDENCE_TYPES.LEAVE });
    const res = await call(refForA, '777');
    expect(res.status).toBe(403);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('a non-numeric reservation id can never match a signed reference', async () => {
    const ref = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE });
    expect((await call(ref, '502abc')).status).toBe(403);
    expect((await call(ref, '../502')).status).toBe(403);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });
});

describe('SEC-EVID-003 — expiration and reserved types', () => {
  it('an expired reference is refused with 410 and never resolves', async () => {
    const expired = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE, evaluatedAt: new Date().toISOString() });
    // Rewrite the exp claim inside the payload is impossible (HMAC); assert the
    // verifier's own expiry branch instead.
    const payload = Buffer.from(JSON.stringify({ v: 1, requestId: 502, proofType: 'leave', recordId: null, note: null, evaluatedAt: new Date().toISOString(), exp: Date.now() - 1000 })).toString('base64url');
    const { createHmac: hmac } = await import('node:crypto');
    const mac = hmac('sha256', process.env.NEXTAUTH_SECRET).update(`fleet-dispatch-evidence-v1:${payload}`).digest('base64url');
    const res = await call(`ev_${payload}.${mac}`);
    expect(res.status).toBe(410);
    expect(resolveEvidence).not.toHaveBeenCalled();
    expect(() => verifyEvidenceRef(expired, { requestId: 502 })).not.toThrow();
  });

  it('the reference TTL is bounded to 15 minutes', () => {
    const data = verifyEvidenceRef(signEvidenceRef({ requestId: 1, proofType: EVIDENCE_TYPES.LEAVE }), { requestId: 1 });
    const ttl = data.exp - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
  });

  it('a reserved (not-yet-active) type is refused with 404 and never resolves', async () => {
    const trail = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.TRAIL });
    const res = await call(trail);
    expect(res.status).toBe(404);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('trail is the only inactive type and it has an empty allowlist', () => {
    expect(ACTIVE_EVIDENCE_TYPES).not.toContain(EVIDENCE_TYPES.TRAIL);
    expect(EVIDENCE_ALLOWLISTS[EVIDENCE_TYPES.TRAIL]).toEqual([]);
  });

  it('malformed references are refused without disclosing existence', async () => {
    for (const bad of ['', 'ev_', 'ev_a.b.c', 'nonsense', 'ev_' + 'A'.repeat(5000), '..', 'ev_x.y']) {
      const res = await call(bad);
      expect([400, 403]).toContain(res.status);
    }
    expect(resolveEvidence).not.toHaveBeenCalled();
  });
});

describe('SEC-EVID-004 — domain separation between the three HMAC tokens', () => {
  it('an evidence reference is not accepted as a dispatch plan token', async () => {
    const ref = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE });
    await expect(verifyPlanToken(ref.replace(/^ev_/, ''))).rejects.toThrow();
  });

  it('an evidence reference is not accepted as an explanation baseline', () => {
    const ref = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE });
    expect(() => verifyExplanationSnapshot(ref.replace(/^ev_/, ''), { requestId: 502 })).toThrow();
  });

  it('a plan token is not accepted as an evidence reference', async () => {
    const token = issuePlanToken({ revision: 'r', proposals: [], expiresAt: new Date(Date.now() + 60000).toISOString() });
    const res = await call(`ev_${token}`);
    expect(res.status).toBe(403);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('an explanation snapshot is not accepted as an evidence reference', async () => {
    const snap = signExplanationSnapshot({ v: 1, requestId: 502, pairs: [], policyVersion: undefined });
    expect((await call(`ev_${snap}`)).status).toBe(403);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });
});

describe('SEC-EVID-005 — default-deny allowlist projection', () => {
  const HOSTILE = {
    driverName: 'Marco Santos', status: 'Approved', startDate: '2026-09-01', endDate: '2026-09-05',
    overlapsBooking: true, evaluatedWindow: { pickupAt: 'a', endAt: 'b' }, verdict: 'blocked',
    reason: 'Oncology treatment', hr_notes: 'private HR note', attachments: ['/private/med-cert.pdf'],
    latitude: 14.5995, longitude: 120.9842, employee_id: 9, password_hash: '$2a$10$secret',
    leave_history: [{ id: 1 }, { id: 2 }], internal_record_id: 4242, cost: 1500.25,
  };

  it('only allowlisted keys for the type survive; every other field is stripped', () => {
    const facts = projectEvidenceFacts(EVIDENCE_TYPES.LEAVE, HOSTILE);
    expect(Object.keys(facts).sort()).toEqual(
      ['driverName', 'endDate', 'overlapsBooking', 'startDate', 'status', 'verdict', 'evaluatedWindow'].sort()
    );
    expect(JSON.stringify(facts)).not.toMatch(/reason|hr_notes|attachments|latitude|longitude|password_hash|leave_history|cost/i);
  });

  it('every evidence type has an explicit allowlist entry (no type falls through to passthrough)', () => {
    for (const type of Object.values(EVIDENCE_TYPES)) expect(EVIDENCE_ALLOWLISTS).toHaveProperty([type]);
  });

  it('no allowlist admits coordinates, free-text descriptions, reasons, costs or attachments', () => {
    const forbidden = /^(latitude|longitude|lat|lng|coordinates|position|description|remarks|reason|notes?|cost|amount|attachments?|file|password_hash|employee_id)$/i;
    for (const [type, keys] of Object.entries(EVIDENCE_ALLOWLISTS)) {
      for (const key of keys) expect(`${type}.${key}`).not.toMatch(forbidden);
    }
  });

  it('the route applies the allowlist to the resolver output (defence in depth)', async () => {
    resolveEvidence.mockResolvedValueOnce({ verdict: 'blocked', status: 'Approved', reason: 'HR_PRIVATE', latitude: 14.5 });
    const ref = signEvidenceRef({ requestId: 502, vehicleId: 4, proofType: EVIDENCE_TYPES.MAINTENANCE });
    const data = await (await call(ref)).json();
    expect(data.facts).toEqual({ verdict: 'blocked', status: 'Approved' });
  });

  it('unsupported proof types are refused before any resolution', async () => {
    const ref = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.TRAIL });
    expect((await call(ref)).status).toBe(404);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });
});

describe('SEC-EVID-006 — the endpoint surface is read-only', () => {
  it('exports GET only — no mutation handler exists', () => {
    expect(Object.keys(evidenceRoute).sort()).toEqual(['GET']);
  });
});

describe('SEC-EVID-007 — proof-type mapping cannot be coaxed into a generic record browser', () => {
  it('every recovery→proof mapping lands on a record-scoped type that has an allowlist', () => {
    const recoveries = [
      { code: 'MAINTENANCE_CONFLICT' }, { code: 'VEHICLE_STATUS' }, { code: 'UVVRP_RESTRICTED' },
      { code: 'PAIRING' }, { code: 'CAPACITY_MISMATCH' }, { code: 'LICENSE_EXPIRED' },
      { code: 'REGISTRATION_EXPIRED' }, { code: 'INSURANCE_EXPIRED' },
      { code: 'DRIVER_UNAVAILABLE', hint: 'Driver is on approved leave.' },
      { code: 'DRIVER_UNAVAILABLE', hint: 'Overlaps dispatch #412.' },
      { code: 'ROUTE_EVIDENCE' }, { code: 'SOMETHING_UNKNOWN' },
    ];
    for (const r of recoveries) {
      const type = proofTypeForRecovery(r);
      if (type == null) continue;
      expect(Object.values(EVIDENCE_TYPES)).toContain(type);
      expect(EVIDENCE_ALLOWLISTS[type].length).toBeGreaterThan(0);
      expect(type).not.toBe(EVIDENCE_TYPES.TRAIL);
    }
    expect(proofTypeForRecovery({ code: 'SOMETHING_UNKNOWN' })).toBeNull();
  });

  it('check→proof mapping only covers checks that have a real underlying record', () => {
    expect(proofTypeForCheck('capacity')).toBe(EVIDENCE_TYPES.CAPACITY);
    expect(proofTypeForCheck('maintenance')).toBe(EVIDENCE_TYPES.MAINTENANCE);
    expect(proofTypeForCheck('registration')).toBe(EVIDENCE_TYPES.COMPLIANCE);
    expect(proofTypeForCheck('request')).toBeNull();
    expect(proofTypeForCheck('category')).toBeNull();
    expect(proofTypeForCheck('incidents')).toBeNull();
    expect(proofTypeForCheck('not-a-check')).toBeNull();
  });
});

describe('SEC-EVID-008 — endpoint authorization and throttling', () => {
  it('requires both reservations:read and reservations:recommend', async () => {
    requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
    const ref = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE });
    await call(ref);
    const calls = requirePermission.mock.calls.map(c => [c[1], c[2]]);
    expect(calls).toEqual([['reservations', 'read'], ['reservations', 'recommend']]);
  });

  it('refuses an unauthenticated caller before any reference handling', async () => {
    const { AuthError } = await import('@/lib/api/utils');
    requirePermission.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
    const res = await call(signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE }));
    expect(res.status).toBe(401);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('rate-limits evidence enumeration attempts', async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false });
    const { AuthError } = await import('@/lib/api/utils');
    requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
    const res = await call(signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE }));
    expect(res.status).toBe(429);
    expect(resolveEvidence).not.toHaveBeenCalled();
    expect(AuthError).toBeTruthy();
  });

  it('responses are private and uncacheable', async () => {
    const res = await call(signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE }));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
