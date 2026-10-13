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
vi.mock('@/services/recommendation.service', () => ({ validatePairAvailability: vi.fn() }));
vi.mock('@/services/dispatch-evidence.service', () => ({ commitDispatchEvidence: vi.fn() }));
vi.mock('@/services/cargo-execution.service', () => ({
  assertCargoCheckpoint: vi.fn(),
  cargoLifecycleEnabled: vi.fn(() => false),
  prepareCargoLifecycle: vi.fn(async () => false),
}));
vi.mock('@/services/status.service', () => ({
  syncVehicleStatus: vi.fn(async () => {}), syncDriverStatus: vi.fn(async () => {}), ensureTripForDispatch: vi.fn(async () => {}),
}));
vi.mock('@/services/transition.service', () => ({ setDispatchStatus: vi.fn() }));
vi.mock('@/lib/validation/helpers', () => ({ validateBody: () => ({}), isValidObject: () => true }));
vi.mock('@/lib/scheduling/conflicts', () => ({ findDispatchConflicts: vi.fn(async () => []) }));
vi.mock('@/lib/uvvrp/uvvrp.service', () => ({ enforceCoding: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/services/driver-schedule.service', () => ({ loadDriverScheduleContext: vi.fn(async () => ({})) }));
vi.mock('@/lib/ai/pair-scoring', async importOriginal => ({
  ...await importOriginal(),
  isDriverUnavailableFor: () => ({ unavailable: false }),
}));

import { query } from '@/lib/db';
import { validatePairAvailability } from '@/services/recommendation.service';
import { commitDispatchEvidence } from '@/services/dispatch-evidence.service';
import { PUT } from './route';

const params = { params: Promise.resolve({ id: '22' }) };
const request = () => new Request('http://localhost/api/dispatch/22', {
  method: 'PUT', body: JSON.stringify({ vehicle_id: 2, driver_id: 3, override_reason: 'Reviewed pair' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async sql => {
    if (sql.includes('SELECT * FROM dispatchschedules WHERE dispatch_id')) return { rows: [{ dispatch_id: 22, request_id: 8,
      vehicle_id: 1, driver_id: 4, scheduled_departure: null, scheduled_arrival: null, status: 'Scheduled' }] };
    if (sql.includes('SELECT load_type FROM transportation_requests')) return { rows: [{ load_type: 'Cargo' }] };
    if (sql.includes('FROM vehicles WHERE')) return { rows: [{ vehicle_id: 2, plate_number: 'TRK-2', vehicle_status: 'Available' }] };
    if (sql.includes('FROM drivers d')) return { rows: [{ driver_id: 3, driver_status: 'Available', license_expiry: '2099-01-01' }] };
    return { rows: [] };
  });
  validatePairAvailability.mockResolvedValue({ ok: true, commitToken: { revision: 'fresh', expiresAt: '2099-01-01T00:00:00Z' } });
});

it('rechecks stored driver, vehicle, and request types before dispatch reassignment writes', async () => {
  const tx = { query: vi.fn(async sql => {
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Passenger', operational_use: 'Cargo' }] };
    if (sql.includes('FROM transportation_requests')) return { rows: [{ request_id: 8, load_type: 'Cargo' }] };
    return { rows: [{ dispatch_id: 22 }] };
  }) };
  commitDispatchEvidence.mockImplementation(async (_token, write) => write(tx));

  const response = await PUT(request(), params);

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/classification does not match/i);
  expect(tx.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE dispatchschedules'))).toBe(false);
});

it('blocks an actual Cargo dispatch without a linked typed request', async () => {
  query.mockImplementation(async sql => {
    if (sql.includes('SELECT * FROM dispatchschedules WHERE dispatch_id')) return { rows: [{ dispatch_id: 22, request_id: null,
      vehicle_id: 1, driver_id: 4, scheduled_departure: null, scheduled_arrival: null, status: 'Scheduled' }] };
    if (sql.includes('FROM vehicles WHERE')) return { rows: [{ vehicle_id: 2, plate_number: 'TRK-2', vehicle_status: 'Available' }] };
    if (sql.includes('FROM drivers d')) return { rows: [{ driver_id: 3, driver_status: 'Available', license_expiry: '2099-01-01' }] };
    return { rows: [] };
  });
  const tx = { query: vi.fn(async sql => {
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] };
    return { rows: [{ dispatch_id: 22 }] };
  }) };
  commitDispatchEvidence.mockImplementation(async (_token, write) => write(tx));

  const response = await PUT(request(), params);

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/marked as Cargo/i);
  expect(tx.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE dispatchschedules'))).toBe(false);
});
