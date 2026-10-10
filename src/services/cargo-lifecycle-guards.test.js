import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCargoCheckpoint } from './cargo-execution.service';
import { setTripStatus, setDispatchStatus } from './transition.service';
import { completeTrip, cancelTrip } from './trip-lifecycle.service';
import * as db from '@/lib/db';

vi.mock('@/services/status.service', () => ({ syncVehicleStatus: vi.fn(async () => null), syncDriverStatus: vi.fn(async () => null) }));
vi.mock('@/services/outbound.service', () => ({ emitTransportStatus: vi.fn() }));
vi.mock('@/services/push.service', () => ({ sendPush: vi.fn() }));
vi.mock('@/services/trip-geofence.service', () => ({ checkPickupProximity: async () => ({ state: 'unknown' }), checkDestinationProximity: async () => ({ state: 'unknown' }) }));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('shared cargo lifecycle boundaries', () => {
  it('default OFF does not read candidate tables', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'OFF');
    const tx = { query: vi.fn(() => { throw new Error('unexpected database read'); }) };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Completed' }, tx)).resolves.toBeNull();
    expect(tx.query).not.toHaveBeenCalled();
  });
  it('refuses attempted enforcement without approved providers before candidate reads', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const tx = { query: vi.fn() };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Trip Started' }, tx)).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
    expect(tx.query).not.toHaveBeenCalled();
  });
  it.each(['Passenger Onboard', 'En Route', 'In Progress', 'Arrived', 'Completed', 'Cancelled'])('shared %s cannot bypass an unconfigured enforcement boundary', async to => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const current = { trip_id: 1, driver_id: 1, vehicle_id: 1, dispatch_id: 1, trip_status: to === 'Passenger Onboard' ? 'At Pickup' : to === 'Arrived' ? 'En Route' : 'In Progress' };
    const statements = [];
    const query = vi.fn(async sql => { statements.push(sql); return { rows: [current] }; });
    vi.spyOn(db, 'query').mockImplementation(query);
    vi.spyOn(db, 'withTransaction').mockImplementation(work => work({ query }));
    const action = to === 'Completed' ? completeTrip(1, { user: { employeeId: 1 } }) : to === 'Cancelled' ? cancelTrip(1, { user: { employeeId: 1 } }) : setTripStatus({ tripId: 1, to, session: { user: { employeeId: 1 } } });
    await expect(action).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
    expect(statements.some(sql => /UPDATE trips/.test(sql))).toBe(false);
  });
  it('dispatch cancellation cannot release trips before the cargo boundary', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const query = vi.fn(async () => ({ rows: [{ dispatch_id: 1, status: 'Scheduled', driver_id: 1, vehicle_id: 1 }] }));
    vi.spyOn(db, 'query').mockImplementation(query);
    vi.spyOn(db, 'withTransaction').mockImplementation(work => work({ query }));
    await expect(setDispatchStatus({ dispatchId: 1, to: 'Cancelled', session: { user: { employeeId: 1 } } })).rejects.toMatchObject({ status: 503 });
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE '))).toBe(false);
  });
});
