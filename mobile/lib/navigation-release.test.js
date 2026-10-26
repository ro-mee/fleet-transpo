import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beginNavigationHandoff } from './navigation-handoff';
import { navigationTarget, externalNavigationUrl } from './navigation-route';
import { launchExternalNavigation } from './external-navigation';
import { legForStatus } from './trip-navigation-phase';
import { createTripBubbleHandoff } from './trip-bubble-handoff';

const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
const trackingStart = source.indexOf('const GPS_TRACKING_STATUSES =');
const trackingEnd = source.indexOf('// Poll churn guard', trackingStart);
const isGpsTrackedTrip = runInNewContext(`${source.slice(trackingStart, trackingEnd)}; isGpsTrackedTrip`);
const config = JSON.parse(readFileSync('mobile/app.json', 'utf8')).expo;
const trip = {
  trip_id: 7, trip_status: 'En Route',
  origin_latitude: 14.6, origin_longitude: 121,
  destination_latitude: 14.7, destination_longitude: 121.1,
  pickup_location_provenance: 'canonical_registry', dropoff_location_provenance: 'canonical_registry',
};
const pickupUrl = 'https://www.google.com/maps/dir/?api=1&destination=14.6%2C121&travelmode=driving&dir_action=navigate';
const destinationUrl = 'https://www.google.com/maps/dir/?api=1&destination=14.7%2C121.1&travelmode=driving&dir_action=navigate';

// Execute the shipped Map action with only native/platform boundaries replaced.
// The handoff prepare no longer starts a background task; it only probes the
// foreground permission (Location), so 'start-failed' has no map-side producer.
function mapAction(permission, tripOverride = {}) {
  const opened = [], warnings = [];
  const context = {
    activeTripRef: { current: { ...trip, ...tripOverride } }, navigationBusyRef: { current: false },
    navigationOperationRef: { current: null },
    tripBubbleRef: { current: createTripBubbleHandoff({ show: async () => {}, hide: async () => {} }) },
    appState: { current: 'active' },
    user: { employeeId: 23 }, captureCargoSession: () => ({}), isCurrentCargoSession: () => true,
    setNavigationBusy: () => {}, navigationTarget, externalNavigationUrl, beginNavigationHandoff,
    launchExternalNavigation, isGpsTrackedTrip, Location: { getForegroundPermissionsAsync: permission },
    useCallback: fn => fn,
    loadTripRef: { current: async () => {} },
    Linking: { openURL: async url => { opened.push(url); } },
    AppAlert: { alert: (...args) => { warnings.push(args); } },
  };
  const start = source.indexOf('  const openExternalNavigation =');
  const end = source.indexOf('  const handleMapReady', start);
  const action = runInNewContext(`${source.slice(start, end)}; openExternalNavigation`, context);
  return { action, context, opened, warnings };
}

describe('external navigation release contract', () => {
  it.each(['Passenger', 'Cargo'])('%s uses the same pickup/delivery authority for navigation and tracking legs', async operationalUse => {
    const phases = [
      ...['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted', 'Trip Started', 'At Pickup']
        .map(status => ({ status, leg: 'leg1', url: pickupUrl })),
      ...['Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress']
        .map(status => ({ status, leg: 'leg2', url: destinationUrl })),
    ];
    for (const { status, leg, url } of phases) {
      const calls = [];
      const result = await beginNavigationHandoff({
        trip: { ...trip, operational_use: operationalUse, load_type: operationalUse, trip_status: status },
        prepare: async options => { calls.push(options); return { ok: true }; },
        openUrl: async value => { calls.push(value); },
      });
      expect(result.ok, status).toBe(true);
      expect(legForStatus(status), status).toBe(leg);
      expect(calls, status).toEqual([{ tripId: 7, leg, requestPermission: true }, url]);
    }
  });

  it.each([
    { trip_status: 'Completed' }, { trip_status: 'Cancelled' }, { trip_status: 'Unknown' }, { trip_status: null },
    { dropoff_location_provenance: 'review_only' }, { dropoff_location_provenance: 'unknown' },
    { trip_status: 'At Pickup', pickup_location_provenance: 'review_only' },
    { destination_latitude: null }, { destination_latitude: 91 }, { destination_longitude: Infinity },
    { trip_id: null },
  ])('refuses unsafe trip data before permission or platform work: %j', async unsafe => {
    const calls = [];
    const result = await beginNavigationHandoff({
      trip: { ...trip, ...unsafe },
      prepare: async () => { calls.push('prepare'); return { ok: true }; },
      openUrl: async () => { calls.push('open'); },
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-target' });
    expect(calls).toEqual([]);
  });

  it('waits for tracking readiness to settle before requesting a platform launch', async () => {
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const calls = [];
    const handoff = beginNavigationHandoff({
      trip, prepare: () => { calls.push('prepare'); return ready; },
      openUrl: async url => { calls.push(url); },
    });
    await Promise.resolve();
    expect(calls).toEqual(['prepare']);
    resolveReady({ ok: true });
    expect((await handoff).ok).toBe(true);
    expect(calls).toEqual(['prepare', destinationUrl]);
  });

  it.each([
    ['permission-denied', async () => ({ status: 'denied' }), {}, destinationUrl],
    ['unsupported', async () => ({ status: 'granted' }), { trip_status: 'Assigned', origin_latitude: 14.6, origin_longitude: 121 }, pickupUrl],
  ])('requires the explicit override after %s and keeps Stay Here safe', async (reason, permission, tripOverride, expectedUrl) => {
    const safe = mapAction(permission, tripOverride);
    await safe.action();
    expect(safe.opened).toEqual([]);
    expect(safe.warnings).toHaveLength(1);
    const safeButtons = safe.warnings[0][2];
    expect(safeButtons.map(button => button.text)).toEqual(['Stay Here', 'Continue Without Tracking']);
    await safeButtons[0].onPress();
    expect(safe.opened).toEqual([]);
    expect(safe.context.navigationBusyRef.current).toBe(false);

    const override = mapAction(permission, tripOverride);
    await override.action();
    expect(override.opened).toEqual([]);
    await override.warnings[0][2][1].onPress();
    expect(override.opened).toEqual([expectedUrl]);
  });

  it('locks duplicate taps through readiness and the warning decision', async () => {
    let resolveReady, signalPrepared, preparations = 0;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const prepared = new Promise(resolve => { signalPrepared = resolve; });
    const map = mapAction(() => { preparations++; signalPrepared(); return ready; });
    const running = map.action();
    const duplicate = map.action();
    await prepared;
    await Promise.resolve();
    expect(preparations).toBe(1);
    expect(map.opened).toEqual([]);
    resolveReady({ status: 'denied' });
    await Promise.all([running, duplicate]);
    await map.action();
    expect(preparations).toBe(1);
    const continueWithoutTracking = map.warnings[0][2][1].onPress;
    await continueWithoutTracking();
    await continueWithoutTracking();
    expect(map.opened).toEqual([destinationUrl]);
  });

  it('refuses a warning override when the current trip has ended', async () => {
    const map = mapAction(async () => ({ status: 'denied' }));
    await map.action();
    map.context.activeTripRef.current = null;
    await map.warnings[0][2][1].onPress();
    expect(map.opened).toEqual([]);
    expect(map.context.navigationBusyRef.current).toBe(false);
  });

  // Re-homed: the stop-before-merge-then-refresh ordering on a foreground return
  // now belongs to the app-level location owner and is pinned by
  // trip-location-owner.test.js ("stops foreground callbacks before background
  // ownership and merges stored mileage once on return" and companions).

  it('retains native background-location and foreground-service configuration', () => {
    expect(config.android.permissions).toEqual(expect.arrayContaining([
      'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ]));
    const location = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-location')?.[1];
    expect(location).toMatchObject({ isAndroidBackgroundLocationEnabled: true, isIosBackgroundLocationEnabled: true });
    expect(location.isAndroidForegroundServiceEnabled).not.toBe(false);
  });
});
