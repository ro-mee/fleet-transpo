import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(async () => ({ user: { employeeId: 1 } })),
  parseBody: request => request.json(),
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (error, status = 400) => Response.json({ error }, { status }),
  errValidation: errors => Response.json({ errors }, { status: 400 }),
  handleError: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));
vi.mock('@/lib/validation/helpers', () => ({ validateBody: () => ({}), isValidObject: () => true }));
vi.mock('@/services/recommendation.service', () => ({ validatePairAvailability: vi.fn() }));
vi.mock('@/services/dispatch-evidence.service', () => ({ commitDispatchEvidence: vi.fn() }));
vi.mock('@/services/driver-qualification-boundaries.service', () => ({ withQualificationWrite: vi.fn() }));
vi.mock('@/services/driver-schedule.service', () => ({ loadDriverScheduleContext: vi.fn(async () => ({})) }));
vi.mock('@/lib/ai/pair-scoring', async importOriginal => ({
  ...await importOriginal(),
  isDriverUnavailableFor: () => ({ unavailable: false }),
}));
vi.mock('@/services/status.service', () => ({
  syncVehicleStatus: vi.fn(async () => {}), syncDriverStatus: vi.fn(async () => {}), ensureTripForDispatch: vi.fn(async () => {}),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/scheduling/conflicts', () => ({ findDispatchConflicts: vi.fn(async () => []) }));
vi.mock('@/services/push.service', () => ({ flushOutbox: vi.fn(async () => {}) }));
vi.mock('@/lib/uvvrp/uvvrp.service', () => ({ enforceCoding: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/services/reservation-lifecycle.service', () => ({ advanceReservation: vi.fn() }));

import { query } from '@/lib/db';
import { validatePairAvailability } from '@/services/recommendation.service';
import { commitDispatchEvidence } from '@/services/dispatch-evidence.service';
import { POST } from './route';

const request = () => new Request('http://localhost/api/dispatch', { method: 'POST', body: JSON.stringify({
  vehicle_id: 9, driver_id: 7, scheduled_departure: '2099-01-01T10:00:00Z', status: 'Scheduled',
}) });

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async sql => {
    if (sql.includes('FROM vehicles WHERE')) return { rows: [{ vehicle_id: 9, plate_number: 'TRK-9', vehicle_status: 'Available', registration_expiry: '2099-12-31', insurance_expiry: '2099-12-31' }] };
    if (sql.includes('FROM drivers d')) return { rows: [{ driver_id: 7, driver_status: 'Available', license_expiry: '2099-12-31' }] };
    return { rows: [] };
  });
  validatePairAvailability.mockResolvedValue({ ok: true, commitToken: { revision: 'fresh', expiresAt: '2099-01-01T00:00:00Z' } });
});

it('blocks a direct Cargo dispatch with no linked typed request before inserting it', async () => {
  const tx = { query: vi.fn(async sql => {
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] };
    return { rows: [{ dispatch_id: 30 }] };
  }) };
  commitDispatchEvidence.mockImplementation(async (_token, write) => write(tx));

  const response = await POST(request());

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/marked as Cargo/i);
  expect(tx.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO dispatchschedules'))).toBe(false);
});
