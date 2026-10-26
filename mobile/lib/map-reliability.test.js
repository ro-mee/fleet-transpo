import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = () => readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
function block(start, end) {
  const text = source();
  const from = text.indexOf(start), to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Map block missing: ${start}`);
  return text.slice(from, to);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

it('keeps unknown native heading distinct from a real north heading', () => {
  const body = source().match(/function driverLocationFromFix[\s\S]*?^}/m)[0];
  const scope = {};
  runInNewContext(body + '\nglobalThis.readFix = driverLocationFromFix;', scope);
  const coords = { latitude: 14.6, longitude: 121, speed: 10 };
  expect(scope.readFix({ coords: { ...coords, heading: null } }).heading).toBeUndefined();
  expect(scope.readFix({ coords: { ...coords, heading: 0 } }).heading).toBe(0);
});

function tripLoader(rows) {
  let active = null, nearby = [], session = { actorId: '23' }, load;
  const scope = {
    useCallback: fn => { load = fn; return fn; }, user: { employeeId: 23 },
    captureCargoSession: () => ({ actorId: '23' }), isCurrentCargoSession: () => true,
    tripRequest: { current: 0 }, api: { get: () => rows },
    isGpsTrackedTrip: trip => ['Driver Accepted', 'Trip Started', 'En Route'].includes(trip?.trip_status),
    samePayload: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    captureTrackedTripRead: () => ({}), setTrackedTrip() {}, setTripSession: value => { session = value; }, setActiveTrip: fn => { active = fn(active); },
    setNearbyTrips: fn => { nearby = fn(nearby); }, prevTripIdsRef: { current: new Set() },
    setRecentNotification() {}, setLoading() {}, console,
  };
  runInNewContext(block('  const loadTrip = useCallback', '  useEffect(() => subscribeApiEvents'), scope);
  return { load, active: () => active, nearby: () => nearby, session: () => session };
}

describe('Map assignment selection and polling', () => {
  it('leaves two pending assignments on standby radar', async () => {
    const rows = [{ trip_id: 1, trip_status: 'Assigned' }, { trip_id: 2, trip_status: 'Dispatched' }];
    const h = tripLoader(Promise.resolve(rows)); await h.load();
    expect(h.active()).toBeNull(); expect(h.nearby()).toEqual(rows);
  });
  it('keeps the ongoing trip ahead of an earlier pending assignment', async () => {
    const pending = { trip_id: 1, trip_status: 'Assigned' }, active = { trip_id: 2, trip_status: 'En Route' };
    const h = tripLoader(Promise.resolve([pending, active])); await h.load();
    expect(h.active()).toEqual(active); expect(h.nearby()).toEqual([pending]);
  });
  it('keeps a valid session while the next poll is in flight', async () => {
    const request = deferred(), h = tripLoader(request.promise);
    const loading = h.load(); expect(h.session()).toEqual({ actorId: '23' });
    request.resolve([]); await loading;
  });
});

it('allows only one assignment acceptance until its request finishes', async () => {
  const request = deferred(), put = vi.fn(() => request.promise);
  const scope = {
    serverConfirmed: true, tripConfirmed: true, connectivity: 'online', nearbyTrips: [{ trip_id: 1 }], profile: { driverType: 'Passenger' },
    resolveDriverWorkspace: () => ({ tripReady: true }), acceptingTripRef: { current: null },
    setAcceptingTripId() {}, assertCurrentOperation() {}, api: { put }, user: { employeeId: 23 },
    tripSession: {}, wasQueued: () => false, AppAlert: { alert() {} }, setSelectedMarker() {}, loadTrip: async () => {},
  };
  runInNewContext(block('  const handleAcceptAssignment = async', '  // Location pipeline') + '\nglobalThis.accept = handleAcceptAssignment;', scope);
  const first = scope.accept(1), second = scope.accept(1);
  expect(put).toHaveBeenCalledOnce(); request.resolve({}); await Promise.all([first, second]);
});

function locationEffect(overrides = {}, state = {}) {
  let cleanup;
  const setDriverLocation = vi.fn(), setLocalGpsError = vi.fn();
  const Location = {
    Accuracy: { Highest: 6, High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    getCurrentPositionAsync: async () => ({ coords: { latitude: 14.6, longitude: 121 }, timestamp: Date.now() }),
    watchPositionAsync: async () => ({ remove() {} }), watchHeadingAsync: async () => ({ remove() {} }),
    ...overrides,
  };
  runInNewContext(block('  // Location pipeline', '  // "Try Again"'), {
    useEffect: fn => { cleanup = fn(); }, emptyStateKey: null, Location,
    setPermissionDenied() {}, setLoading() {}, setLocalGpsError, setLocalFixAt() {},
    setDriverLocation, driverLocationFromFix: loc => loc ? ({ lat: loc.coords.latitude, lng: loc.coords.longitude }) : null,
    lastFixRef: { current: null }, focusedRef: { current: true }, lastCompassHeading: { current: null },
    activeTrip: null, activeTripRef: { current: null }, isGpsTrackedTrip: () => false, legForStatus: () => null,
    distRef: { current: {} }, permRetry: 0, mapFocused: true, appForeground: true,
    activeTripIdForTracking: null, activeTripStatusForTracking: null,
    haversineKm: () => 0, console, setTimeout: () => 0, clearTimeout() {},
    ...state,
  });
  return { cleanup: () => cleanup?.(), setDriverLocation, setLocalGpsError };
}

describe('asynchronous Map subscriptions', () => {
  it('removes a position subscription that starts after cleanup', async () => {
    const start = deferred(), remove = vi.fn();
    const h = locationEffect({ watchPositionAsync: () => start.promise });
    await flush(); h.cleanup(); start.resolve({ remove }); await flush();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('does not start watchers after a seed fix resolves after cleanup', async () => {
    const seed = deferred(), watchPositionAsync = vi.fn();
    const h = locationEffect({ getCurrentPositionAsync: () => seed.promise, watchPositionAsync });
    await flush(); h.cleanup(); seed.resolve({ coords: { latitude: 14.6, longitude: 121 } }); await flush();
    expect(watchPositionAsync).not.toHaveBeenCalled(); expect(h.setDriverLocation).not.toHaveBeenCalled();
  });
  it('removes a compass subscription that starts after cleanup', async () => {
    const start = deferred(), remove = vi.fn();
    const h = locationEffect({ watchHeadingAsync: () => start.promise });
    await flush(); h.cleanup(); start.resolve({ remove }); await flush();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('surfaces failures reported by an established GPS watcher', async () => {
    let fail;
    const h = locationEffect({ watchPositionAsync: async (_, __, error) => { fail = error; return { remove() {} }; } });
    await flush(); fail('Provider disabled');
    expect(h.setLocalGpsError).toHaveBeenCalledWith(expect.stringContaining('Location updates stopped'));
    h.cleanup();
  });
  it.each([{ mapFocused: false }, { appForeground: false }])('stops visual sensors when hidden: %j', async state => {
    const watchPositionAsync = vi.fn(), watchHeadingAsync = vi.fn();
    const h = locationEffect({ watchPositionAsync, watchHeadingAsync }, state); await flush();
    expect(watchPositionAsync).not.toHaveBeenCalled(); expect(watchHeadingAsync).not.toHaveBeenCalled(); h.cleanup();
  });
  it('uses the app-owned trip stream and unsubscribes without stopping trip collection', async () => {
    let deliver;
    const unsubscribe = vi.fn(), watchPositionAsync = vi.fn();
    const h = locationEffect({ watchPositionAsync }, {
      isGpsTrackedTrip: () => true, getTripLocation: () => null,
      subscribeTripLocation: fn => { deliver = fn; return unsubscribe; },
    });
    await flush(); deliver({ coords: { latitude: 14.6, longitude: 121 }, timestamp: Date.now() });
    expect(h.setDriverLocation).toHaveBeenCalled(); expect(watchPositionAsync).not.toHaveBeenCalled();
    h.cleanup(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

it('turns a hung map load into a recoverable failure without declaring it ready', () => {
  let timeout;
  const setMapReady = vi.fn(), setMapReadyKey = vi.fn(), setMapError = vi.fn();
  runInNewContext(block('  // Fail-open for the map overlay', '  if (isDutyResolving)'), {
    useEffect: fn => fn(), mapReady: false, mapFailed: false, mapInstanceKey: 'standby', mapShouldRender: true,
    routeData: null, now: Date.now(),
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout() {},
    setMapReady, setMapReadyKey, setMapError,
  });
  timeout(); expect(setMapReady).not.toHaveBeenCalled(); expect(setMapReadyKey).not.toHaveBeenCalled();
  expect(setMapError).toHaveBeenCalled();
});

it('releases route-option loading when the renderer never answers an apply command', () => {
  let timeout;
  const applyingRoute = { current: true }, setRoutePhase = vi.fn(), setRouteStale = vi.fn();
  runInNewContext(block('  // A bridge command', '  const routeDisabledReason'), {
    useEffect: fn => fn(), routePhase: 'refreshing', routeLegKey: 'trip-1-pickup',
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout() {},
    applyingRoute, setRoutePhase, setRouteStale,
  });
  timeout(); expect(applyingRoute.current).toBe(false);
  expect(setRoutePhase).toHaveBeenCalledWith('failed'); expect(setRouteStale).toHaveBeenCalledWith(true);
});

it('invalidates prior route guidance when a new map document starts loading', () => {
  const setRouteStale = vi.fn();
  runInNewContext(block('  const handleMapLoading', '  const handleMapReady') + '\nhandleMapLoading();', {
    useCallback: fn => fn, setMapReadyKey() {}, setMapError() {}, setRouteStale, setRoutePhase() {},
  });
  expect(setRouteStale).toHaveBeenCalledWith(true);
});
