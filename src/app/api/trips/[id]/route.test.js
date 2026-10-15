import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/api/utils', () => {
  class AuthError extends Error {
    constructor(message, status = 500, code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    AuthError,
    requirePermission: vi.fn(async () => ({ user: { employeeId: 1 } })),
    parseBody: request => request.json(),
    ok: (data, status = 200) => Response.json(data, { status }),
    err: (error, status = 400) => Response.json({ error }, { status }),
    errValidation: errors => Response.json({ errors }, { status: 400 }),
    // Mirrors the real handleError: only AuthError maps to its status,
    // anything else is a 500. A missing VEHICLE_LOAD_INCOMPATIBLE catch in
    // the route therefore surfaces as 500 here, not 409.
    handleError: error => (error instanceof AuthError
      ? Response.json({ error: error.message }, { status: error.status })
      : Response.json({ error: 'Internal server error' }, { status: 500 })),
  };
});
vi.mock('@/lib/api/trips-query', () => ({ TRIPS_SELECT: '*', TRIPS_JOINS: '' }));
vi.mock('../../route', () => ({ TRIP_WRITABLE: ['vehicle_id', 'driver_id', 'dispatch_id', 'trip_status', 'notes'] }));
vi.mock('@/lib/drivers/trip-type-gate', () => ({ tripDriverTypeMismatch: vi.fn(async () => null) }));

// Real compatibility evaluator + real cargo checkpoint against the mocked
// transaction query, so the 409/503 codes come from the actual services.
import { query, withTransaction } from '@/lib/db';
import { PUT } from './route';

let txQuery;
const tx = { query: (...args) => txQuery(...args) };
const params = { params: Promise.resolve({ id: '3' }) };
const put = payload => PUT(new Request('http://localhost/api/trips/3', {
  method: 'PUT', body: JSON.stringify(payload),
}), params);

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  withTransaction.mockImplementation(async write => write(tx));
  txQuery = async sql => (sql.startsWith('UPDATE') ? { rows: [{ trip_id: 3 }] } : { rows: [] });
});

it('refuses reassignment onto a Cargo vehicle without typed load', async () => {
  txQuery = async sql => {
    if (sql.includes('SELECT driver_id, vehicle_id, dispatch_id FROM trips')) {
      return { rows: [{ driver_id: 7, vehicle_id: 1, dispatch_id: null }] };
    }
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Passenger', operational_use: 'Cargo' }] };
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 3, dispatch_id: null, stored_dispatch_id: null, request_id: null,
        stored_request_id: null, service_type: null, load_type: null,
        driver_type: 'Passenger', operational_use: 'Passenger' }] };
    }
    if (sql.startsWith('UPDATE')) return { rows: [{ trip_id: 3 }] };
    return { rows: [] };
  };

  const response = await put({ vehicle_id: 9 });

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/does not match this vehicle/i);
});

it('keeps the cargo checkpoint refusal on a Cargo trip', async () => {
  txQuery = async sql => {
    if (sql.includes('SELECT driver_id, vehicle_id, dispatch_id FROM trips')) {
      return { rows: [{ driver_id: 7, vehicle_id: 9, dispatch_id: 11 }] };
    }
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 3, dispatch_id: 11, stored_dispatch_id: 11, request_id: 4,
        stored_request_id: 4, service_type: 'PASSENGER', load_type: 'Cargo',
        driver_type: 'Cargo', operational_use: 'Cargo' }] };
    }
    if (sql.startsWith('UPDATE')) return { rows: [{ trip_id: 3 }] };
    return { rows: [] };
  };

  const response = await put({ trip_status: 'Driver Accepted' });

  expect(response.status).toBe(503);
});

it('updates a Passenger trip unchanged', async () => {
  txQuery = async sql => {
    if (sql.includes('SELECT driver_id, vehicle_id, dispatch_id FROM trips')) {
      return { rows: [{ driver_id: 7, vehicle_id: 1, dispatch_id: null }] };
    }
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Passenger', operational_use: 'Passenger' }] };
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 3, dispatch_id: null, stored_dispatch_id: null, request_id: null,
        stored_request_id: null, service_type: null, load_type: null,
        driver_type: 'Passenger', operational_use: 'Passenger' }] };
    }
    if (sql.startsWith('UPDATE')) return { rows: [{ trip_id: 3, notes: 'x' }] };
    return { rows: [] };
  };

  const response = await put({ notes: 'x' });

  expect(response.status).toBe(200);
});
