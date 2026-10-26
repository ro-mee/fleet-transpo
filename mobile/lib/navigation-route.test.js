import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createTripBubbleHandoff } from './trip-bubble-handoff';
import { ROUTE_CONTROLLER_SCRIPT, navigationTarget, externalNavigationUrl } from './navigation-route';

function response(summaries = [[600, 12000], [720, 14000]]) {
  return {
    routes: summaries.map(([time, length]) => ({ summary: { travelTimeInSeconds: time, lengthInMeters: length, trafficDelayInSeconds: 60 }, guidance: { instructions: [{ routeOffsetInMeters: length }] } })),
    toGeoJson: () => ({ features: summaries.map((_, i) => ({ geometry: { type: 'LineString', coordinates: [[121, 14.6], [121.01 + i / 100, 14.7]] } })) }),
  };
}
function setup(config = {}) {
  const calculateRoute = vi.fn().mockResolvedValue(response());
  const messages = [];
  let geometry = null;
  const map = { getLayer: id => id === 'route' && geometry, getSource: () => ({ setData: value => { geometry = value; } }), addLayer: layer => { geometry = layer.source.data; } };
  const window = { fleetRouteConfig: { key: 'test-key', primary: '#285448', sessionKey: 'trip-1-pickup', alternatives: true, traffic: true, ...config }, ttMap: map,
    currentCarLng: 121, currentCarLat: 14.6, currentDestLng: 121.1, currentDestLat: 14.7,
    ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) }, updateNavigationBanner: vi.fn() };
  runInNewContext(ROUTE_CONTROLLER_SCRIPT, { window, tt: { services: { calculateRoute } }, Date, setTimeout, clearTimeout });
  return { window, calculateRoute, messages, geometry: () => geometry, last: () => messages.at(-1) };
}

describe('real WebView route controller', () => {
  it('requests actual alternatives and publishes selected geometry, ETA and distance together', async () => {
    const h = setup();
    await h.window.recalculateRoute(121, 14.6);
    expect(h.calculateRoute).toHaveBeenCalledWith(expect.objectContaining({ maxAlternatives: 2, traffic: true, computeTravelTimeFor: 'all' }));
    expect(h.last()).toMatchObject({ type: 'ROUTE_CALCULATED', sessionKey: 'trip-1-pickup', travelTimeInSeconds: 600, lengthInMeters: 12000 });
    expect(h.last().routes).toHaveLength(2);
    expect(h.geometry().features[0].geometry.coordinates).toEqual(h.window.routeCoords);
  });
  it('applies toll avoidance to the provider and updates all telemetry', async () => {
    const h = setup();
    await h.window.recalculateRoute(121, 14.6);
    h.calculateRoute.mockResolvedValueOnce(response([[900, 16000]]));
    await h.window.recalculateRoute(121, 14.6, { avoidTolls: true, selectedIndex: 0 });
    expect(h.calculateRoute.mock.calls.at(-1)[0].avoid).toBe('tollRoads');
    expect(h.last()).toMatchObject({ travelTimeInSeconds: 900, lengthInMeters: 16000, preferences: { avoidTolls: true } });
    expect(h.last().routes).toHaveLength(1);
    await h.window.recalculateRoute(121.01, 14.61);
    expect(h.calculateRoute.mock.calls.at(-1)[0].avoid).toBe('tollRoads');
  });
  it('selects only provider-backed alternate geometry and retains the selection on refresh', async () => {
    const h = setup();
    await h.window.recalculateRoute(121, 14.6);
    h.window.applyRoutePreferences({ avoidTolls: false, selectedIndex: 1 });
    expect(h.calculateRoute).toHaveBeenCalledTimes(1);
    expect(h.last()).toMatchObject({ travelTimeInSeconds: 720, lengthInMeters: 14000, preferences: { selectedIndex: 1 } });
    expect(h.window.routeCoords[1][0]).toBeCloseTo(121.02, 8);
    expect(h.window.routeCoords[1][1]).toBe(14.7);
    await h.window.recalculateRoute(121.01, 14.61);
    expect(h.last().preferences.selectedIndex).toBe(1);
  });
  it('retains provider observation time when selecting an existing alternate', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
      const h = setup();
      await h.window.recalculateRoute(121, 14.6);
      const observed = h.last().calculatedAt;
      vi.setSystemTime(new Date('2026-10-22T00:06:00Z'));
      h.window.applyRoutePreferences({ avoidTolls: false, selectedIndex: 1 });
      expect(h.last().calculatedAt).toBe(observed);
    } finally { vi.useRealTimers(); }
  });
  it('returns to recommended honestly when a previously selected alternate is absent', async () => {
    const h = setup();
    await h.window.recalculateRoute(121, 14.6);
    h.window.applyRoutePreferences({ avoidTolls: false, selectedIndex: 1 });
    h.calculateRoute.mockResolvedValueOnce(response([[700, 13000]]));
    await h.window.recalculateRoute(121, 14.6);
    expect(h.last().preferences.selectedIndex).toBe(0);
    expect(h.last().routes).toHaveLength(1);
  });
  it.each(['rejection', 'empty', 'invalid'])('retains the valid route and applied settings after %s', async kind => {
    const h = setup();
    await h.window.recalculateRoute(121, 14.6);
    const previous = h.geometry();
    if (kind === 'rejection') h.calculateRoute.mockRejectedValueOnce(new Error('Offline'));
    else h.calculateRoute.mockResolvedValueOnce(response(kind === 'empty' ? [] : [[NaN, -1]]));
    await h.window.recalculateRoute(121, 14.6, { avoidTolls: true, selectedIndex: 0 });
    expect(h.geometry()).toBe(previous);
    expect(h.last()).toMatchObject({ type: 'ROUTE_UNAVAILABLE', retained: true, preferences: { avoidTolls: false } });
    expect(h.window.isRecalculating).toBe(false);
  });
  it('does not let an older in-flight response overwrite a newer preference', async () => {
    const h = setup();
    let resolveOld;
    h.calculateRoute.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const old = h.window.recalculateRoute(121, 14.6);
    await Promise.resolve();
    const recent = h.window.recalculateRoute(121, 14.6, { avoidTolls: true, selectedIndex: 0 });
    await recent;
    resolveOld(response([[60, 100]]));
    await old;
    expect(h.last()).toMatchObject({ travelTimeInSeconds: 600, preferences: { avoidTolls: true } });
  });
  it('uses session preferences on a new leg and defaults on a different trip', async () => {
    const leg = setup({ avoidTolls: true });
    await leg.window.recalculateRoute(121, 14.6);
    expect(leg.calculateRoute.mock.calls[0][0].avoid).toBe('tollRoads');
    const nextTrip = setup();
    await nextTrip.window.recalculateRoute(121, 14.6);
    expect(nextTrip.calculateRoute.mock.calls[0][0]).not.toHaveProperty('avoid');
  });
  it('handles a first-route provider failure without inventing geometry', async () => {
    const h = setup();
    h.calculateRoute.mockRejectedValueOnce(new Error('Provider failed'));
    await h.window.recalculateRoute(121, 14.6);
    expect(h.last()).toMatchObject({ type: 'ROUTE_UNAVAILABLE', retained: false });
    expect(h.geometry()).toBeNull();
  });
  it('times out a hung provider and releases the controls', async () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      h.calculateRoute.mockImplementationOnce(() => new Promise(() => {}));
      const request = h.window.recalculateRoute(121, 14.6);
      await vi.advanceTimersByTimeAsync(20001);
      expect(await request).toBe(false);
      expect(h.last()).toMatchObject({ type: 'ROUTE_UNAVAILABLE', retained: false });
      expect(h.window.isRecalculating).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('rejects absent GPS/target coordinates but accepts valid zero coordinates', async () => {
    const h = setup();
    await h.window.recalculateRoute(null, 14.6);
    expect(h.calculateRoute).not.toHaveBeenCalled();
    expect(h.last().reason).toBe('MISSING_LOCATION');
    h.window.currentDestLng = 0; h.window.currentDestLat = 0;
    await h.window.recalculateRoute(0, 0);
    expect(h.calculateRoute.mock.calls[0][0].locations).toBe('0,0:0,0');
  });
});

describe('trusted operational target', () => {
  const trip = { trip_status: 'Trip Started', origin_latitude: 14.6, origin_longitude: 121, destination_latitude: 14.7, destination_longitude: 121.1 };
  it.each(['Trip Started', 'At Pickup', 'Driver Accepted', 'Assigned'])('targets pickup in %s', trip_status => expect(navigationTarget({ ...trip, trip_status })).toEqual({ lat: 14.6, lng: 121 }));
  it.each(['Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress'])('targets delivery in %s', trip_status => expect(navigationTarget({ ...trip, trip_status, load_type: 'Cargo' })).toEqual({ lat: 14.7, lng: 121.1 }));
  it.each([null, undefined, '', 'Completed', 'Cancelled', 'Unexpected Status'])(
    'does not choose a target for %s', trip_status => expect(navigationTarget({ ...trip, trip_status })).toBeNull()
  );
  it.each(['pending_review', 'unknown'])('does not navigate using %s coordinates', pickup_location_provenance => expect(navigationTarget({ ...trip, pickup_location_provenance })).toBeNull());
  it('clears terminal trip targets and never substitutes address text', () => {
    expect(navigationTarget({ ...trip, trip_status: 'Completed' })).toBeNull();
    expect(navigationTarget({ ...trip, origin_latitude: null, origin: 'Warehouse' })).toBeNull();
    expect(externalNavigationUrl(null)).toBeNull();
    expect(externalNavigationUrl(navigationTarget(trip))).toContain('destination=14.6%2C121');
    expect(externalNavigationUrl(navigationTarget({ ...trip, trip_status: 'En Route' }))).toContain('destination=14.7%2C121.1');
  });
});

describe('Google Maps navigation URL', () => {
  it('requests driving navigation to encoded coordinates', () => {
    expect(externalNavigationUrl({ lat: 14.6, lng: 121 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.6%2C121&travelmode=driving&dir_action=navigate'
    );
  });
  it.each([
    null, { lat: NaN, lng: 121 }, { lat: 14.6, lng: NaN },
    { lat: -90.1, lng: 121 }, { lat: 90.1, lng: 121 },
    { lat: 14.6, lng: -180.1 }, { lat: 14.6, lng: 180.1 },
  ])('rejects an invalid target: %j', target => {
    expect(externalNavigationUrl(target)).toBeNull();
  });
  it.each([
    [{ lat: 0, lng: 0 }, '0%2C0'],
    [{ lat: -90, lng: -180 }, '-90%2C-180'],
    [{ lat: 90, lng: 180 }, '90%2C180'],
  ])('accepts valid zero and boundary coordinates: %j', (target, encoded) => {
    expect(externalNavigationUrl(target)).toContain(`destination=${encoded}&`);
  });
});

describe('Map foreground return recovery', () => {
  const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
  const trip = { trip_id: 7, trip_status: 'Trip Started', origin_latitude: 14.6, origin_longitude: 121, destination_latitude: 14.7, destination_longitude: 121.1 };
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  function recovery(load_type, response) {
    let change, sessionCurrent = true;
    const calls = [], snapshot = {}, activeTripRef = { current: { ...trip, load_type } };
    const distRef = { current: { leg1: 1, leg2: 0, prev: {}, pending: {} } };
    const context = {
      useRef: current => ({ current }), useEffect: fn => fn(), useCallback: fn => fn,
      AppState: { currentState: 'background', addEventListener: (_, fn) => { change = fn; return { remove() {} }; } },
      activeTripRef, distRef, navigationBusyRef: { current: false }, navigationOperationRef: { current: null },
      trackingTransitionRef: { current: Promise.resolve() }, loadTripRef: { current: null },
      tripBubbleRef: { current: createTripBubbleHandoff({ show: async () => {}, hide: async () => {} }) },
      isGpsTrackedTrip: value => ['Driver Accepted', 'Trip Started', 'En Route'].includes(value?.trip_status),
      stopBackgroundTracking: vi.fn(async () => { calls.push('stop'); }),
      mergeStoredKm: vi.fn(async (target, expectedTripId) => { calls.push(`merge:${expectedTripId}`); if (expectedTripId === 7) target.current.leg1 += 2; }),
      api: { get: vi.fn(async () => { calls.push('load'); return response; }) },
      user: { employeeId: 23 }, captureCargoSession: () => snapshot, isCurrentCargoSession: value => value === snapshot && sessionCurrent,
      setTripSession: vi.fn(), setActiveTrip: vi.fn(),
      setNearbyTrips: vi.fn(), setRecentNotification: vi.fn(), setLoading: vi.fn(),
      samePayload: (a, b) => JSON.stringify(a) === JSON.stringify(b), console, setTimeout,
    };
    const start = source.indexOf('  const appState = useRef(AppState.currentState);');
    const end = source.indexOf('  useEffect(() => subscribeApiEvents', start);
    runInNewContext(source.slice(start, end), context);
    return { ...context, change, calls, endSession: () => { sessionCurrent = false; } };
  }

  it.each(['Passenger', 'Cargo'])('stops, merges and refreshes the canonical %s trip on return', async load_type => {
    const refreshed = { ...trip, load_type, trip_status: 'En Route' };
    const h = recovery(load_type, [refreshed]);
    h.change('active'); await h.trackingTransitionRef.current;
    expect(h.calls).toEqual(['stop', 'merge:7', 'load']);
    expect(h.activeTripRef.current).toEqual(refreshed);
    expect(navigationTarget(h.activeTripRef.current)).toEqual({ lat: 14.7, lng: 121.1 });
    expect(h.distRef.current).toEqual({ leg1: 3, leg2: 0, prev: null, pending: null });
  });

  it.each([[], [{ ...trip, trip_status: 'Completed' }], [{ ...trip, trip_status: 'Cancelled' }]])('clears an absent or ended trip immediately after the return refresh (%j)', async response => {
    const h = recovery('Passenger', response);
    h.change('active'); await h.trackingTransitionRef.current;
    expect(h.activeTripRef.current).toBeNull();
    expect(navigationTarget(h.activeTripRef.current)).toBeNull();
  });

  it('does not merge a previous trip into a replacement assignment while stop is pending', async () => {
    const replacement = { ...trip, trip_id: 8 };
    const h = recovery('Cargo', [replacement]);
    let resolveStop;
    h.stopBackgroundTracking.mockImplementation(() => new Promise(resolve => { resolveStop = resolve; }));
    h.change('active'); await flush();
    h.activeTripRef.current = replacement;
    h.distRef.current = { leg1: 0, leg2: 0 };
    resolveStop(); await h.trackingTransitionRef.current;
    expect(h.distRef.current.leg1).toBe(0);
    expect(h.mergeStoredKm).toHaveBeenCalledWith(expect.anything(), null);
    expect(h.activeTripRef.current).toEqual(replacement);
  });

  it('does not let an obsolete return response overwrite a newer trip refresh', async () => {
    const h = recovery('Cargo', []);
    let resolveOld;
    h.api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    h.change('active'); await flush();
    const replacement = { ...trip, trip_id: 8 };
    h.api.get.mockResolvedValueOnce([replacement]);
    await h.loadTripRef.current();
    resolveOld([{ ...trip, trip_status: 'En Route' }]); await h.trackingTransitionRef.current;
    expect(h.activeTripRef.current).toEqual(replacement);
  });

  it('keeps a delayed distance merge attached to the returning accumulator', async () => {
    const h = recovery('Passenger', [{ ...trip, trip_id: 8 }]);
    let resolveMerge;
    h.mergeStoredKm.mockImplementation(target => new Promise(resolve => {
      resolveMerge = () => { target.current.leg1 += 2; resolve(); };
    }));
    h.change('active'); await flush();
    const returningDistance = h.distRef.current;
    h.activeTripRef.current = { ...trip, trip_id: 8 };
    h.distRef.current = { leg1: 0, leg2: 0 };
    resolveMerge(); await h.trackingTransitionRef.current;
    expect(h.distRef.current.leg1).toBe(0);
    expect(returningDistance.leg1).toBe(3);
  });

  it('ignores the return refresh after the captured driver session ends', async () => {
    const h = recovery('Cargo', []);
    let resolveLoad;
    h.api.get.mockImplementation(() => new Promise(resolve => { resolveLoad = resolve; }));
    h.change('active'); await flush();
    h.endSession();
    resolveLoad([]); await h.trackingTransitionRef.current;
    expect(h.activeTripRef.current.trip_id).toBe(7);
    expect(h.setActiveTrip).not.toHaveBeenCalled();
  });
});

it('executes the hidden Map completion listener and clears only its confirmed active trip', () => {
  const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
  const start = source.indexOf('  useEffect(() => subscribeApiEvents(event => {');
  const end = source.indexOf('  // `duty`', start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  let listener;
  const activeTripRef = { current: { trip_id: 7, load_type: 'Cargo' } };
  const tripRequest = { current: 2 };
  const setActiveTrip = vi.fn(), setRouteData = vi.fn(), setRouteChoices = vi.fn(), loadTrip = vi.fn();
  const setCompletedCargo = vi.fn();
  const completionSession = { actorId: '23', signal: new AbortController().signal };
  const updateLegContext = vi.fn().mockResolvedValue(undefined), stopBackgroundTracking = vi.fn().mockResolvedValue(undefined);
  runInNewContext(source.slice(start, end), {
    useEffect: fn => fn(), subscribeApiEvents: fn => { listener = fn; }, activeTripRef, tripRequest,
    setActiveTrip, setRouteData, setRouteChoices, loadTrip, updateLegContext, stopBackgroundTracking,
    tripBubbleRef: { current: createTripBubbleHandoff({ show: async () => {}, hide: async () => {} }) },
    profile: { driverType: 'Cargo' }, user: { employeeId: 23 }, setCompletedCargo,
    captureCargoSession: () => completionSession, isCurrentCargoSession: () => true, isCargoLoad: trip => trip.load_type === 'Cargo',
  });
  listener({ type: 'queued', tripId: 7 }); listener({ type: 'trip-completed', tripId: 8 });
  expect(activeTripRef.current.trip_id).toBe(7); expect(loadTrip).not.toHaveBeenCalled();
  listener({ type: 'trip-completed', tripId: '7' });
  expect(activeTripRef.current).toBeNull(); expect(tripRequest.current).toBe(3);
  expect(setActiveTrip).toHaveBeenCalledWith(null); expect(setRouteData).toHaveBeenCalledWith(null);
  expect(loadTrip).toHaveBeenCalledOnce();
  expect(setCompletedCargo).toHaveBeenCalledWith({ tripId: 7, reference: 'TRP-7', session: completionSession });
});

// Foreground/background completion races are exercised on the app-level owner
// in trip-location-owner.test.js, which now owns the native subscriptions.
