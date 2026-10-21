import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { readinessFor } from './trip-detail';
import { resolveDriverWorkspace } from './driver-workspace';
import { workspaceBlockReason } from './cargo-view-model';
import { tripActionLabel, isCargoLoad } from './load-presentation';

const source = readFileSync(new URL('../app/(app)/(tabs)/map.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const block = source.slice(source.indexOf('const workspace = resolveDriverWorkspace({ driverType: profile?.driverType, trip: activeTrip });'), source.indexOf('\n  return (', source.indexOf('// Departure-window gate')));
const swipe = source.slice(source.indexOf('<SwipeButton\n', source.indexOf('// Departure-window gate')), source.indexOf('                onSwipeSuccess=', source.indexOf('// Departure-window gate'))) + '/>';
const { code } = await transform(`function render(){ ${block}; return (${swipe}); }`, { loader: 'jsx', format: 'cjs' });
function render(overrides = {}) {
  const deps = { activeTrip: { trip_id: 7, vehicle_id: 2, operational_use: 'Cargo', load_type: 'Cargo', trip_status: 'Driver Accepted', pre_trip_status: 'Passed', earliest_start: '2020-01-01T00:00:00Z' },
    profile: { driverType: 'Cargo' }, duty: { loaded: true, checkedIn: true }, now: Date.now(), isPending: false, isDriverAccepted: true,
    serverConfirmed: true, tripConfirmed: true, connectivity: 'online', inFlight: false, colors: {},
    readinessFor, resolveDriverWorkspace, workspaceBlockReason, tripActionLabel, isCargoLoad,
    React: { createElement: (_, props) => props }, SwipeButton: () => {}, ...overrides };
  return runInNewContext(`${code}; render()`, deps);
}
describe('real Cargo Map start control', () => {
  it.each([null, 'invalid', '2099-01-01T00:00:00Z'])('disables start for unavailable or closed timing: %s', earliest_start => {
    const props = render({ activeTrip: { trip_id: 7, vehicle_id: 2, operational_use: 'Cargo', load_type: 'Cargo', trip_status: 'Driver Accepted', pre_trip_status: 'Passed', earliest_start } });
    expect(props.disabled).toBe(true); expect(props.title).not.toBe('START ROUTE');
  });
  it.each([{ duty: { loaded: false, checkedIn: false } }, { duty: { loaded: true, checkedIn: false } }, { serverConfirmed: false }, { tripConfirmed: false }, { connectivity: 'offline' }])('holds start when authority is unresolved: %s', overrides => {
    const props = render(overrides); expect(props.disabled).toBe(true); expect(props.title).not.toBe('START ROUTE');
  });
  it('enables Cargo start only with known passed checks and open timing', () => {
    expect(render()).toMatchObject({ title: 'START ROUTE', disabled: false });
  });
  it.each([null, 'Failed'])('allows Cargo inspection navigation while actual start remains gated: %s', pre_trip_status => {
    const props = render({ activeTrip: { trip_id: 7, vehicle_id: 2, operational_use: 'Cargo', load_type: 'Cargo', trip_status: 'Driver Accepted', earliest_start: '2020-01-01T00:00:00Z', pre_trip_status } });
    expect(props).toMatchObject({ title: 'PRE-TRIP CHECK', disabled: false });
  });
  it('blocks an incompatible assignment even when timing and inspections pass', () => {
    const props = render({ profile: { driverType: 'Passenger' } });
    expect(props).toMatchObject({ title: 'TRIP ACTION UNAVAILABLE', disabled: true });
  });
  it('preserves the intentional Passenger unknown-timing exception', () => {
    const props = render({ profile: { driverType: 'Passenger' }, activeTrip: { trip_id: 7, vehicle_id: 2, operational_use: 'Passenger', load_type: null, trip_status: 'Driver Accepted', pre_trip_status: 'Passed' } });
    expect(props).toMatchObject({ title: 'START ROUTE', disabled: false });
  });
});
