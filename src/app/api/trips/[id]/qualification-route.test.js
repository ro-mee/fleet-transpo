import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ body: {}, service: 'HOTEL_SUPPLY_TRANSFER', status: 'ACTIVE', calls: [] }));
vi.mock('@/lib/db', () => {
  const query = vi.fn(async (sql, values) => {
    fixture.calls.push({ sql, values });
    if (sql.includes('driver_service_qualifications')) return { rows: [{ driver_id: 9, group: 'CARGO', status: fixture.status, verified_by: 1,
      verified_at: '2026-10-09T00:00:00Z', policy_version: 'fixture-v1', version: 1 }] };
    if (sql.includes('transportation_requests')) return { rows: [{ service_code: fixture.service }] };
    if (sql.startsWith('UPDATE trips')) return { rows: [{ trip_id: 7, ...fixture.body }] };
    if (sql.includes('FROM trips')) return { rows: [{ driver_id: 2, dispatch_id: 8 }] };
    return { rows: [{ driver_id: 9 }] };
  });
  return { query, withTransaction: fn => fn({ query }) };
});
vi.mock('../route', () => ({ TRIP_WRITABLE: ['driver_id', 'dispatch_id', 'trip_status'] }));
vi.mock('@/lib/api/utils', () => ({ requirePermission: vi.fn(), parseBody: async () => fixture.body,
  ok: data => Response.json(data), err: (error, status) => Response.json({ error }, { status }),
  handleError: e => Response.json({ error: e.message, code: e.code }, { status: e.status || 500 }),
  AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } } }));
import { PUT } from './route';
const run = () => PUT(new Request('http://localhost/api/trips/7', { method: 'PUT' }), { params: Promise.resolve({ id: '7' }) });
beforeEach(() => {
  fixture.body = { driver_id: 9, trip_status: 'En Route' }; fixture.service = 'HOTEL_SUPPLY_TRANSFER'; fixture.status = 'ACTIVE'; fixture.calls = [];
  vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE'); vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'fixture-v1');
  vi.stubEnv('DRIVER_QUALIFICATION_ROSTER_REVIEW', 'fixture-review'); vi.stubEnv('DRIVER_QUALIFICATION_EXISTING_TRIPS', 'RECHECK');
});
afterEach(() => vi.unstubAllEnvs());
it.each(['RESTAURANT_SUPPLY_PICKUP', 'RESTAURANT_FOOD_DELIVERY', 'HOTEL_SUPPLY_TRANSFER'])('rechecks the effective replacement driver for stored %s', async service => {
  fixture.service = service;
  expect((await run()).status).toBe(200);
  expect(fixture.calls.find(call => call.sql.includes('driver_service_qualifications')).values).toEqual([[9]]);
  expect(fixture.calls.find(call => call.sql.includes('FOR UPDATE')).values).toEqual([9]);
});
it('refuses a revoked replacement before any trip write', async () => {
  fixture.status = 'REVOKED';
  expect((await run()).status).toBe(409);
  expect(fixture.calls.some(call => call.sql.startsWith('UPDATE trips'))).toBe(false);
});
it('uses stored passenger service despite a caller cargo override', async () => {
  fixture.service = 'GUEST_TRANSPORT'; fixture.body.service_code = 'HOTEL_SUPPLY_TRANSFER';
  const response = await run();
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('DRIVER_SERVICE_QUALIFICATION_REQUIRED');
  expect(fixture.calls.some(call => call.sql.startsWith('UPDATE trips'))).toBe(false);
});
it('keeps OFF free of new qualification reads and locks', async () => {
  vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'OFF');
  expect((await run()).status).toBe(200);
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.calls[0].sql).toMatch(/^UPDATE trips/);
});
it('permits SHADOW writes with revoked approval', async () => {
  vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'SHADOW'); fixture.status = 'REVOKED';
  expect((await run()).status).toBe(200);
  expect(fixture.calls.some(call => call.sql.includes('FOR UPDATE'))).toBe(false);
});
