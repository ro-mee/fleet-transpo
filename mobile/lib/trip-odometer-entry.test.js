import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace';
import { readinessFor } from './trip-detail';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const helper = { exports: {} };
const code = (await transform(read('./trip-odometer.js'), { format: 'cjs' })).code;
runInNewContext(code, { module: helper, exports: helper.exports, require: () => ({}) });
const { odometerStartRoute } = helper.exports;
const base = { trip_id: 7, trip_status: 'Driver Accepted', vehicle_id: 2, load_type: 'Passenger', operational_use: 'Passenger', pre_trip_status: 'Passed', earliest_start: '2020-01-01', odometer_photo_required_at_start: true };
describe('required odometer start entry points execute their actual handlers', () => {
  it.each([true, false])('Home routes passed=%s into the shared journey before any write', async passed => {
    const source = read('../app/(app)/(tabs)/index.js');
    const callback = source.slice(source.indexOf('async (trip) => {', source.indexOf('const handleTripAction')), source.indexOf('}, [canManageTrip', source.indexOf('const handleTripAction')) + 1);
    const router = { push: vi.fn() }, api = { put: vi.fn() };
    const action = runInNewContext(`(${callback})`, { canManageTrip: true, driverProfile: { driverType: 'Passenger' }, resolveDriverWorkspace, confirmedSession: {}, isCurrentCargoSession: () => true, getNextStatus: async () => ({ status: 'Trip Started', action: 'start' }), router, odometerStartRoute, doAction: vi.fn(), api, setCompletingTrip: vi.fn(), preShiftPassed: true });
    const trip = { ...base, pre_trip_status: passed ? 'Passed' : null };
    await action(trip);
    expect(router.push).toHaveBeenCalledWith(odometerStartRoute(trip)); expect(api.put).not.toHaveBeenCalled();
  });
  it.each([['Passenger', false], ['Cargo', false], ['Passenger', true], ['Cargo', true]])('Map opens required photo journey for %s passed=%s before any movement write', async (driverType, passed) => {
    const source = read('../app/(app)/(tabs)/map.js');
    const start = source.indexOf('onSwipeSuccess={async () => {', source.indexOf('// Departure-window gate'));
    const body = source.slice(start + 'onSwipeSuccess={'.length, source.indexOf('\n                  }}', start) + '\n                  }'.length);
    const router = { push: vi.fn() }, api = { put: vi.fn() };
    const trip = { ...base, load_type: driverType, operational_use: driverType, pre_trip_status: passed ? 'Passed' : null };
    const handler = runInNewContext(`(${body})`, { inFlight: false, serverConfirmed: true, tripConfirmed: true, connectivity: 'online', profile: { driverType }, activeTrip: trip, isPending: false, isDriverAccepted: true, duty: { loaded: true, checkedIn: true }, resolveDriverWorkspace, readinessFor, odometerStartRoute, isCurrentCargoSession: () => true, tripSession: {}, api, router, setInFlight: vi.fn(), preTripDone: false, windowOpen: true, AppAlert: { alert: vi.fn() }, captureCargoSession: () => ({}), resolveCargoMapGate: async () => ({ allowed: true }), user: { employeeId: 10 } });
    await handler();
    expect(router.push).toHaveBeenCalledWith(odometerStartRoute(trip)); expect(api.put).not.toHaveBeenCalled();
  });
  it.each([true, false])('trip detail primary opens the photo journey with passed=%s', passed => {
    const source = read('../app/(app)/trip/[id].js');
    const start = source.indexOf('const handlePrimary = () => {');
    const callback = source.slice(start + 'const handlePrimary = '.length, source.indexOf('\n  const depMs', start)).trim().replace(/;$/, '');
    const trip = { ...base, pre_trip_status: passed ? 'Passed' : null }, router = { push: vi.fn() }, handleAcceptStart = vi.fn();
    const handler = runInNewContext(`(${callback})`, { canOperate: true, ready: { unavailableReason: passed ? null : 'inspection' }, router, id: 7, trip, odometerStartRoute, handleAcceptStart });
    handler(); expect(router.push).toHaveBeenCalledWith(odometerStartRoute(trip)); expect(handleAcceptStart).not.toHaveBeenCalled();
  });
});
