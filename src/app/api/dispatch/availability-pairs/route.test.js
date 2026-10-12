import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(async () => null),
  ok: (data, status = 200) => Response.json(data, { status }),
  handleError: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));
vi.mock('@/lib/uvvrp/uvvrp.service', () => ({
  loadVehicleTravelContext: vi.fn(async () => null),
  vehicleCanTravel: vi.fn(() => true),
}));
vi.mock('@/services/driver-schedule.service', () => ({
  loadDriverScheduleContext: vi.fn(async () => ({ schedules: new Map(), leave: new Map() })),
}));
vi.mock('@/services/driver-qualification-boundaries.service', () => ({
  loadQualificationContext: vi.fn(async () => null),
  driverQualificationFinding: vi.fn(() => null),
  qualificationSummary: vi.fn(() => null),
  storedQualificationService: vi.fn(async () => 'FREIGHT_TRANSFER'),
}));
vi.mock('@/lib/ai/pair-scoring', async importOriginal => ({
  ...await importOriginal(),
  resolveVehiclePairing: ({ driverById }) => ({ ok: true, kind: 'designated', driver: driverById.get(7), designated: driverById.get(7) }),
  vehicleOperationallyAvailable: () => true,
}));

import { query } from '@/lib/db';
import { GET } from './route';

let vehicle, driver, loadType;
beforeEach(() => {
  vi.clearAllMocks();
  vehicle = { vehicle_id: 9, vehicle_name: 'Truck', plate_number: 'TRK-9', vehicle_status: 'Available',
    operational_use: 'Cargo', seating_capacity: 2, cargo_capacity_kg: 1000, category_name: 'Cargo' };
  driver = { driver_id: 7, driver_type: 'Cargo', driver_status: 'Available', first_name: 'Casey', last_name: 'Driver' };
  loadType = null;
  query.mockImplementation(async sql => {
    if (sql.includes('FROM vehicles v')) return { rows: [vehicle] };
    if (sql.includes('FROM drivers d')) return { rows: [driver] };
    if (sql.includes('FROM driver_vehicle_assignments')) return { rows: [{ driver_id: 7, vehicle_id: 9 }] };
    if (sql.includes('FROM substitute_vehicle_schedules')) return { rows: [] };
    if (sql.includes('FROM dispatchschedules')) return { rows: [] };
    if (sql.includes('FROM transportation_requests')) return { rows: [{ request_id: 1, load_type: loadType }] };
    return { rows: [] };
  });
});

const get = (search = '') => GET(new Request(`http://localhost/api/dispatch/availability-pairs${search}`));

it('keeps a matching Cargo custody pair available when no request is selected', async () => {
  const response = await get();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.ready).toHaveLength(1);
  expect(body.blocked).toHaveLength(0);
});

it('blocks a Cargo pair for an actual request whose stored load type is missing', async () => {
  const response = await get('?request_id=1');
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.ready).toHaveLength(0);
  expect(body.blocked[0].block_reason).toMatch(/marked as Cargo/i);
});

it('filters by the stored load type when the caller selects a request', async () => {
  loadType = 'Passenger';
  const response = await get('?request_id=1');
  const body = await response.json();
  expect(body.ready).toHaveLength(0);
  expect(body.blocked[0].block_reason).toMatch(/load type does not match/i);
});

it('requests driver type and vehicle operational use for the availability check', async () => {
  await get();
  expect(query.mock.calls.find(([sql]) => sql.includes('FROM vehicles v'))[0]).toMatch(/operational_use/);
  expect(query.mock.calls.find(([sql]) => sql.includes('FROM drivers d'))[0]).toMatch(/driver_type/);
});
