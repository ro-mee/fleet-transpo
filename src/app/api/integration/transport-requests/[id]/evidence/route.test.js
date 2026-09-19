import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({ requirePermission: vi.fn(), AuthError: class extends Error { constructor(message, status) { super(message); this.status = status; } }, handleError: e => Response.json({ error: e.message }, { status: e.status ?? 500 }) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/services/reservation-lifecycle.service', () => ({ loadRequest: vi.fn(async () => ({ request_id: 502, pickup_datetime: '2026-09-16T10:00:00+08:00', passenger_count: 2 })) }));
vi.mock('@/services/evidence-resolve.service', () => ({ resolveEvidence: vi.fn(async () => ({ status: 'In Progress', verdict: 'blocked', description: 'should be stripped' })) }));
import { requirePermission } from '@/lib/api/utils';
import { resolveEvidence } from '@/services/evidence-resolve.service';
import { signEvidenceRef, EVIDENCE_TYPES } from '@/lib/dispatch/evidence-contract';
import { GET } from './route';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-evidence';
const call = (ref, id = '502') => GET(
  new Request(`http://localhost/evidence?ref=${encodeURIComponent(ref ?? '')}`, { method: 'GET' }),
  { params: Promise.resolve({ id }) },
);
beforeEach(() => { vi.clearAllMocks(); requirePermission.mockResolvedValue({ user: { employeeId: 1 } }); });

it('is GET-only and returns allowlisted facts with read-only envelope', async () => {
  expect(GET).toBeDefined();
  const ref = signEvidenceRef({ requestId: 502, vehicleId: 1, proofType: EVIDENCE_TYPES.MAINTENANCE });
  const data = await (await call(ref)).json();
  expect(data).toMatchObject({ type: 'maintenance', title: 'Maintenance Evidence', readOnly: true, requestId: 502 });
  expect(data.facts).toEqual({ status: 'In Progress', verdict: 'blocked' });
  expect(data).toHaveProperty('checkedAt');
  expect(data.managingModule).toBeTruthy();
});

it('rejects missing, cross-request, tampered and inactive refs without leaking', async () => {
  expect((await call(null)).status).toBe(400);
  const other = signEvidenceRef({ requestId: 999, proofType: EVIDENCE_TYPES.LEAVE });
  expect((await call(other)).status).toBe(403);
  const good = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.LEAVE });
  expect((await call(good.slice(0, -2) + 'xx')).status).toBe(403);
  const trail = signEvidenceRef({ requestId: 502, proofType: EVIDENCE_TYPES.TRAIL });
  expect((await call(trail)).status).toBe(404);
  expect(resolveEvidence).not.toHaveBeenCalled();
});
it('resolves comparison refs while trail stays unresolvable', async () => {
  const ref = signEvidenceRef({ requestId: 502, vehicleId: 1, driverId: 2, proofType: EVIDENCE_TYPES.COMPARISON, recordId: '3:4' });
  const data = await (await call(ref)).json();
  expect(data.type).toBe('comparison');
  expect(resolveEvidence).toHaveBeenCalled();
});
