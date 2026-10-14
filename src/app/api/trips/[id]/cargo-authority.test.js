import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({ requirePermission: async () => ({ user: { employeeId: 1 } }), parseBody: req => req.json(), ok: body => Response.json(body), err: (error, status) => Response.json({ error }, { status }), handleError: error => Response.json({ error: error.message, code: error.code }, { status: error.status ?? 500 }), AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } } }));
vi.mock('@/app/api/trips/route', () => ({ TRIP_WRITABLE: ['trip_status', 'vehicle_id', 'dispatch_id'] }));
vi.mock('@/lib/drivers/trip-type-gate', () => ({ tripDriverTypeMismatch: async () => null }));
vi.mock('@/services/reservation-lifecycle.service', () => ({ loadRequest: vi.fn(), advanceReservation: vi.fn() }));
vi.mock('@/services/status.service', () => ({ syncVehicleStatus: vi.fn(), syncDriverStatus: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
import { query, withTransaction } from '@/lib/db';
import { loadRequest, advanceReservation } from '@/services/reservation-lifecycle.service';
import { PUT } from './route';
import { PUT as cancelRequest } from '../../integration/transport-requests/[id]/cancel/route';
const saved = { trip_id: 1, dispatch_id: 2, stored_dispatch_id: 2, request_id: 3, stored_request_id: 3, load_type: 'Passenger', driver_type: 'Passenger', operational_use: 'Passenger' };
const run = (handler, body) => handler(new Request('http://localhost/api/trips/1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: '1' }) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CARGO_LIFECYCLE_MODE', 'OFF'); withTransaction.mockImplementation(work => work({ query })); });
afterEach(() => vi.unstubAllEnvs());
it.each(['Passenger Onboard', 'Completed', 'Cancelled'])('generic Cargo %s refuses before writes despite posted Passenger', async trip_status => {
  query.mockResolvedValue({ rows: [{ ...saved, load_type: 'Cargo' }] });
  const response = await run(PUT, { trip_status, load_type: 'Passenger' });
  expect(response.status).toBe(503);
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
});
it('generic Passenger cannot reassign into a persisted Cargo dispatch', async () => {
  query.mockImplementation(async sql => ({ rows: sql.includes('FROM dispatchschedules ds') ? [{ stored_dispatch_id: 4, request_id: 5, stored_request_id: 5, load_type: 'Cargo' }] : [saved] }));
  expect((await run(PUT, { dispatch_id: 4 })).status).toBe(503);
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
});
it.each(['Passenger', null])('generic stored %s still updates in unconfigured ENFORCE', async load_type => {
  vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
  query.mockResolvedValue({ rows: [{ ...saved, load_type, trip_status: 'Passenger Onboard' }] });
  const response = await run(PUT, { trip_status: 'Passenger Onboard' });
  expect(response.status).toBe(200);
  expect((await response.json()).trip_status).toBe('Passenger Onboard');
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(true);
});
it('Cargo request cancellation refuses before any cascade with enforcement OFF', async () => {
  loadRequest.mockResolvedValue({ request_id: 1, load_type: 'Cargo', fleet_status: 'Assigned' });
  expect((await run(cancelRequest, { load_type: 'Passenger' })).status).toBe(503);
  expect(query).not.toHaveBeenCalled();
  expect(advanceReservation).not.toHaveBeenCalled();
});
