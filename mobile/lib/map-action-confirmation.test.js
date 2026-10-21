import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readinessFor } from './trip-detail';

const source = readFileSync(new URL('../app/(app)/(tabs)/map.js', import.meta.url), 'utf8');
const start = source.indexOf('onSwipeSuccess={async () => {') + 'onSwipeSuccess={'.length;
const end = source.indexOf('}}', source.indexOf('return confirmed', start)) + 1;
const handler = source.slice(start, end);
function setup({ state = 1, queued = false, cargo = false, allowed = true, outside = false, current = true, error = false, code = handler } = {}) {
  const trip = { trip_id: 7, trip_status: state === 3 ? 'En Route' : 'Trip Started' };
  const session = { actorId: 23 };
  const api = { get: vi.fn().mockResolvedValue({ state: outside ? 'outside' : 'inside' }), put: vi.fn().mockImplementation(async () => { if (error) throw Error('refused'); return queued ? { queued: true } : { trip_status: 'accepted' }; }) };
  const deps = { inFlight: false, serverConfirmed: true, tripConfirmed: true, connectivity: 'online', profile: { driverType: cargo ? 'Cargo' : 'Passenger' }, activeTrip: trip, tripSession: session, user: { employeeId: 23 },
    resolveDriverWorkspace: () => ({ tripReady: true, mode: cargo ? 'cargo' : 'passenger' }), setInFlight: vi.fn(), AppAlert: { alert: vi.fn() }, workspaceBlockReason: () => 'blocked', captureCargoSession: () => session, isCurrentCargoSession: () => current,
    resolveCargoMapGate: async () => ({ allowed, reason: 'Fleet hold', route: 'cargo' }), cargoApi: {}, getCargoSyncState: () => ({}), router: { push: vi.fn() }, api, assertCurrentOperation: () => {}, wasQueued: response => !!response?.queued, announceSavedForSync: vi.fn(), loadTrip: vi.fn(), offerOverride: vi.fn(), preTripDone: true, windowOpen: true,
    readinessFor, odometerStartRoute: () => null, duty: { loaded: true, checkedIn: true },
    isPending: false, isDriverAccepted: state === 0, isState1: state === 1, isState2: state === 2, isState3: state === 3, isState4: state === 4 };
  return { action: runInNewContext(`(${code})`, deps), api, deps };
}
describe('real Map acknowledgement returned to SwipeButton', () => {
  it.each([{ serverConfirmed: false }, { tripConfirmed: false }, { connectivity: 'offline' }, { resolveDriverWorkspace: () => ({ tripReady: false, mode: 'cargo' }) }])('keeps Cargo actions fenced by current profile/assignment/session: %s', override => {
    const h = setup({ cargo: true, state: 0 }); Object.assign(h.deps, override);
    h.deps.activeTrip.earliest_start = '2020-01-01T00:00:00Z'; h.deps.activeTrip.pre_trip_status = 'Passed';
    return h.action().then(() => expect(h.api.put).not.toHaveBeenCalled());
  });
  it.each([null, 'Failed'])('refuses Cargo accept/start before passed Pre-Trip: %s', pre_trip_status => {
    const h = setup({ cargo: true, state: 0 }); h.deps.isPending = true;
    h.deps.activeTrip.earliest_start = '2020-01-01T00:00:00Z'; h.deps.activeTrip.pre_trip_status = pre_trip_status;
    return h.action().then(() => expect(h.api.put).not.toHaveBeenCalled());
  });
  it('starts ready Cargo using the existing confirmed endpoint', async () => {
    const h = setup({ cargo: true, state: 0 });
    h.deps.activeTrip.earliest_start = '2020-01-01T00:00:00Z'; h.deps.activeTrip.pre_trip_status = 'Passed';
    expect(await h.action()).toBe(true); expect(h.api.put.mock.calls.at(-1)[0]).toBe('/api/trips/7/start');
  });
  it.each([null, 'invalid', '2099-01-01T00:00:00Z'])('refuses Cargo start before accept/write for unknown or closed timing: %s', earliest_start => {
    const h = setup({ cargo: true, state: 0 });
    h.deps.activeTrip.earliest_start = earliest_start;
    h.deps.activeTrip.pre_trip_status = 'Passed';
    return h.action().then(() => expect(h.api.put).not.toHaveBeenCalled());
  });
  it.each([{ loaded: false, checkedIn: false }, { loaded: true, checkedIn: false }])('refuses Cargo start without confirmed Pre-Shift: %s', duty => {
    const h = setup({ cargo: true, state: 0 }); h.deps.duty = duty;
    h.deps.activeTrip.earliest_start = '2020-01-01T00:00:00Z'; h.deps.activeTrip.pre_trip_status = 'Passed';
    return h.action().then(() => expect(h.api.put).not.toHaveBeenCalled());
  });
  it.each([[0, 'start'], [1, 'at-pickup'], [2, 'enroute'], [3, 'dropoff']])('confirms acknowledged state %s (%s)', async (state, endpoint) => {
    const h = setup({ state }); expect(await h.action()).toBe(true);
    expect(h.api.put.mock.calls.at(-1)[0]).toBe(`/api/trips/7/${endpoint}`);
  });
  it.each([{ queued: true }, { error: true }, { current: false }, { outside: true }, { cargo: true, allowed: false }, { state: 4 }])('never confirms a queued/refused/held/navigation-only action: %s', async options => {
    const h = setup(options); expect(await h.action()).not.toBe(true);
  });
  it('detects a missing acknowledgement return rather than assuming callback resolution is success', async () => {
    const h = setup({ code: handler.replace('return confirmed && isCurrentCargoSession(tripSession);', '') });
    expect(await h.action()).toBeUndefined();
  });
});
