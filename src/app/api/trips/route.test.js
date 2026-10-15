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
vi.mock('@/lib/trips/filters', () => ({ appendTripFilters: vi.fn(), validateServiceCode: () => null }));
vi.mock('@/lib/api/trips-query', () => ({ TRIPS_LIST_SELECT: '*', TRIPS_JOINS: '' }));
vi.mock('@/lib/drivers/trip-type-gate', () => ({ tripDriverTypeMismatch: vi.fn(async () => null) }));

// Real compatibility evaluator + real cargo checkpoint against the mocked
// transaction query, so the 409/503 codes come from the actual services.
import { query, withTransaction } from '@/lib/db';
import { POST } from './route';

let txQuery;
const tx = { query: (...args) => txQuery(...args) };
const body = extra => new Request('http://localhost/api/trips', {
  method: 'POST', body: JSON.stringify({ vehicle_id: 9, driver_id: 7, trip_status: 'Assigned', ...extra }),
});

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  withTransaction.mockImplementation(async write => write(tx));
  txQuery = async () => ({ rows: [] });
});

it('refuses an unlinked Cargo pair without typed load', async () => {
  txQuery = async sql => {
    if (sql.startsWith('INSERT INTO trips')) {
      return { rows: [{ trip_id: 5, driver_id: 7, vehicle_id: 9, dispatch_id: null, trip_status: 'Assigned' }] };
    }
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] };
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 5, dispatch_id: null, stored_dispatch_id: null, request_id: null,
        stored_request_id: null, service_type: null, load_type: null, driver_type: 'Cargo', operational_use: 'Cargo' }] };
    }
    return { rows: [] };
  };

  const response = await POST(body());

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/authority could not be resolved/i);
});

it('returns 503 for a Cargo request-linked trip without cargo authority', async () => {
  txQuery = async sql => {
    if (sql.startsWith('INSERT INTO trips')) {
      return { rows: [{ trip_id: 6, driver_id: 7, vehicle_id: 9, dispatch_id: 11, trip_status: 'Assigned' }] };
    }
    if (sql.includes('SELECT request_id FROM dispatchschedules')) return { rows: [{ request_id: 4 }] };
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] };
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 6, dispatch_id: 11, stored_dispatch_id: 11, request_id: 4,
        stored_request_id: 4, service_type: 'PASSENGER', load_type: 'Cargo', driver_type: 'Cargo', operational_use: 'Cargo' }] };
    }
    if (sql.includes('FROM transportation_requests')) return { rows: [{ request_id: 4, load_type: 'Cargo' }] };
    return { rows: [] };
  };

  const response = await POST(body({ dispatch_id: 11 }));

  expect(response.status).toBe(503);
  expect((await response.json()).error).toMatch(/not configured/i);
});

it('refuses a mismatched pair as a 409, not a 500', async () => {
  txQuery = async sql => {
    if (sql.startsWith('INSERT INTO trips')) {
      return { rows: [{ trip_id: 7, driver_id: 7, vehicle_id: 9, dispatch_id: 11, trip_status: 'Assigned' }] };
    }
    if (sql.includes('SELECT request_id FROM dispatchschedules')) return { rows: [{ request_id: 4 }] };
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Passenger', operational_use: 'Cargo' }] };
    if (sql.includes('FROM transportation_requests')) return { rows: [{ request_id: 4, load_type: 'Passenger' }] };
    return { rows: [] };
  };

  const response = await POST(body({ dispatch_id: 11 }));

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/does not match this vehicle/i);
});

it('creates a Passenger trip unchanged', async () => {
  txQuery = async sql => {
    if (sql.startsWith('INSERT INTO trips')) {
      return { rows: [{ trip_id: 8, driver_id: 7, vehicle_id: 9, dispatch_id: 11, trip_status: 'Assigned' }] };
    }
    if (sql.includes('SELECT request_id FROM dispatchschedules')) return { rows: [{ request_id: 4 }] };
    if (sql.includes('SELECT d.driver_type')) return { rows: [{ driver_type: 'Passenger', operational_use: 'Passenger' }] };
    if (sql.includes('SELECT t.trip_id, t.dispatch_id')) {
      return { rows: [{ trip_id: 8, dispatch_id: 11, stored_dispatch_id: 11, request_id: 4,
        stored_request_id: 4, service_type: 'PASSENGER', load_type: 'Passenger',
        driver_type: 'Passenger', operational_use: 'Passenger' }] };
    }
    if (sql.includes('FROM transportation_requests')) return { rows: [{ request_id: 4, load_type: 'Passenger' }] };
    return { rows: [] };
  };

  const response = await POST(body({ dispatch_id: 11 }));

  expect(response.status).toBe(201);
});
