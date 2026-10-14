import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCargoCheckpoint, createCargoExecutionService, prepareCargoLifecycle } from './cargo-execution.service';
import { setTripStatus, setDispatchStatus } from './transition.service';
import { completeTrip, cancelTrip } from './trip-lifecycle.service';
import * as db from '@/lib/db';

vi.mock('@/services/status.service', () => ({ syncVehicleStatus: vi.fn(async () => null), syncDriverStatus: vi.fn(async () => null) }));
vi.mock('@/services/outbound.service', () => ({ emitTransportStatus: vi.fn(async () => null) }));
vi.mock('@/services/push.service', () => ({ sendPush: vi.fn(async () => null) }));
vi.mock('@/services/trip-geofence.service', () => ({ checkPickupProximity: async () => ({ state: 'unknown' }), checkDestinationProximity: async () => ({ state: 'unknown' }) }));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('shared cargo lifecycle boundaries', () => {
  it('default OFF allows stored Passenger without reading candidate tables', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'OFF');
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, request_id: 1, stored_dispatch_id: 1, stored_request_id: 1, load_type: 'Passenger' }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Completed' }, tx)).resolves.toBeNull();
    expect(tx.query.mock.calls.every(([sql]) => !sql.includes('cargo_trip_executions'))).toBe(true);
  });
  it('refuses attempted enforcement without approved providers before candidate reads', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, request_id: 1, stored_dispatch_id: 1, stored_request_id: 1, load_type: 'Cargo' }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Trip Started' }, tx)).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
    expect(tx.query.mock.calls.every(([sql]) => !sql.includes('cargo_trip_executions'))).toBe(true);
  });
  it.each(['OFF', 'ENFORCE'])('stored Cargo refuses unavailable authority in %s despite a posted Passenger type', async mode => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', mode);
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, request_id: 1, stored_dispatch_id: 1, stored_request_id: 1, load_type: 'Cargo' }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1, load_type: 'Passenger' }, { to: 'Passenger Onboard' }, tx)).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
  });
  it('unconfigured ENFORCE allows a stored historical Passenger', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, stored_dispatch_id: 1, request_id: 1, stored_request_id: 1, load_type: null, driver_type: 'Passenger', operational_use: 'Passenger' }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Completed' }, tx)).resolves.toBeNull();
  });
  it.each(['Passenger Onboard', 'En Route', 'In Progress', 'Arrived', 'Completed', 'Cancelled'])('shared %s cannot bypass an unconfigured enforcement boundary', async to => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'OFF');
    const current = { trip_id: 1, driver_id: 1, vehicle_id: 1, dispatch_id: 1, stored_dispatch_id: 1, request_id: 1, stored_request_id: 1, load_type: 'Cargo', trip_status: to === 'Passenger Onboard' ? 'At Pickup' : to === 'Arrived' ? 'En Route' : 'In Progress' };
    const statements = [];
    const query = vi.fn(async sql => { statements.push(sql); return { rows: [current] }; });
    vi.spyOn(db, 'query').mockImplementation(query);
    vi.spyOn(db, 'withTransaction').mockImplementation(work => work({ query }));
    const action = to === 'Completed' ? completeTrip(1, { user: { employeeId: 1 } }) : to === 'Cancelled' ? cancelTrip(1, { user: { employeeId: 1 } }) : setTripStatus({ tripId: 1, to, session: { user: { employeeId: 1 } } });
    await expect(action).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
    expect(statements.some(sql => /UPDATE trips/.test(sql))).toBe(false);
  });
  it('dispatch cancellation cannot release trips before the cargo boundary', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'OFF');
    const query = vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, stored_dispatch_id: 1, request_id: 1, stored_request_id: 1, load_type: 'Cargo', status: 'Scheduled', driver_id: 1, vehicle_id: 1 }] }));
    vi.spyOn(db, 'query').mockImplementation(query);
    vi.spyOn(db, 'withTransaction').mockImplementation(work => work({ query }));
    await expect(setDispatchStatus({ dispatchId: 1, to: 'Cancelled', session: { user: { employeeId: 1 } } })).rejects.toMatchObject({ status: 503 });
    expect(query.mock.calls.some(([sql]) => /^\s*UPDATE /.test(sql))).toBe(false);
  });
  it('cannot reassign Passenger into a saved Cargo dispatch', async () => {
    const tx = { query: vi.fn(async sql => ({ rows: sql.includes('FROM trips t')
      ? [{ trip_id: 1, dispatch_id: 1, stored_dispatch_id: 1, load_type: 'Passenger' }]
      : [{ stored_dispatch_id: 2, request_id: 3, stored_request_id: 3, load_type: 'Cargo' }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Reassign', patch: { dispatch_id: 2 } }, tx)).rejects.toMatchObject({ status: 503 });
  });
  it('cannot cancel a Cargo dispatch that has no trip yet', async () => {
    const query = vi.fn(async sql => ({ rows: sql.includes('FROM trips') ? [] : [{ dispatch_id: 1, stored_dispatch_id: 1, request_id: 2, stored_request_id: 2, load_type: 'Cargo', status: 'Scheduled', fleet_status: 'Assigned' }] }));
    vi.spyOn(db, 'query').mockImplementation(query);
    vi.spyOn(db, 'withTransaction').mockImplementation(work => work({ query }));
    await expect(setDispatchStatus({ dispatchId: 1, to: 'Cancelled', session: { user: { employeeId: 1 } } })).rejects.toMatchObject({ status: 503 });
    expect(query.mock.calls.some(([sql]) => /^\s*UPDATE /.test(sql))).toBe(false);
  });
  it.each([
    { service_type: 'SUPPLY_DELIVERY', request_id: null, stored_request_id: null, load_type: null },
    { load_type: null, driver_type: 'Cargo', operational_use: 'Cargo' },
    { load_type: 'Unknown' },
    { stored_request_id: null },
    { stored_dispatch_id: null },
  ])('refuses unresolved or Cargo stored source $service_type/$load_type before writes', async source => {
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 1, stored_dispatch_id: 1, request_id: 2, stored_request_id: 2, ...source }] })) };
    await expect(assertCargoCheckpoint({ trip_id: 1, load_type: 'Passenger' }, { to: 'Completed' }, tx)).rejects.toMatchObject({ code: source.service_type === 'SUPPLY_DELIVERY' ? 'CARGO_CONFIGURATION_REQUIRED' : 'CARGO_LINKAGE_CONFLICT' });
    expect(tx.query.mock.calls.some(([sql]) => /^\s*UPDATE /.test(sql))).toBe(false);
  });
  it('keeps bound nonproduction lifecycle fixtures and driver table-before-row locks valid', async () => {
    const config = { schemaReady: true, simulated: true, environment: 'test', ...Object.fromEntries(['dataApprovalRef', 'privacyApprovalRef', 'receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef', 'safetyApprovalRef', 'fleetApprovalRef', 'lifecycleApprovalRef'].map(key => [key, 'simulated:approval'])) };
    const statements = [];
    const base = { query: async sql => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM trips')) return { rows: [{ trip_id: 1, dispatch_id: 2, driver_id: 3, trip_status: 'Driver Accepted' }] };
      if (sql.includes('SELECT * FROM dispatchschedules')) return { rows: [{ dispatch_id: 2, request_id: 4 }] };
      if (sql.includes('SELECT employee_id')) return { rows: [{ employee_id: 5 }] };
      if (sql.includes('SELECT d.request_id')) return { rows: [{ dispatch_id: 2, request_id: 4, load_type: 'Passenger' }] };
      return { rows: [] };
    } };
    const service = createCargoExecutionService({ db: { withTransaction: work => work(base) }, config, authorizeLifecycle: async () => true });
    const tx = service.bindLifecycleTransaction(base);
    await prepareCargoLifecycle(tx);
    await expect(assertCargoCheckpoint({ trip_id: 1 }, { to: 'Trip Started', session: { user: { employeeId: 5 } } }, tx)).resolves.toBeNull();
    expect(statements[0]).toBe('LOCK TABLE drivers IN SHARE ROW EXCLUSIVE MODE');
    expect(statements[1]).toContain('FROM drivers');
    expect(statements[2]).toContain('FROM trips');
  });
  it('takes one shared table preflight before runtime parent locks, even when ENFORCE has no provider', async () => {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    const tx = { query: vi.fn(async () => ({ rows: [{ trip_id: 1, dispatch_id: 2, stored_dispatch_id: 2, request_id: 3, stored_request_id: 3, load_type: 'Passenger' }] })) };
    await prepareCargoLifecycle(tx);
    await assertCargoCheckpoint({ trip_id: 1 }, { to: 'Completed' }, tx);
    expect(tx.query.mock.calls[0][0]).toBe('LOCK TABLE drivers, vehicles IN SHARE ROW EXCLUSIVE MODE');
    expect(tx.query.mock.calls.filter(([sql]) => sql.startsWith('LOCK TABLE'))).toHaveLength(1);
    expect(tx.query.mock.calls[1][0]).toContain('FOR UPDATE OF t');
  });
});
