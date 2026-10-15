import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import React from 'react';
import { createTripBubbleHandoff, invalidateTripBubbleWork } from './trip-bubble-handoff';
import * as deepLink from './trip-deep-link';
import { isDriverSession } from './rbac';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function hooks() {
  const values = [], effects = []; let index = 0;
  const react = { ...React, useState: value => {
    const slot = index++; if (!(slot in values)) values[slot] = typeof value === 'function' ? value() : value;
    return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
  }, useRef: value => ({ current: value }), useEffect: fn => { effects.push(fn); }, useCallback: fn => fn };
  return { react, effects, render: fn => { index = 0; return fn(); } };
}
async function component(path, dependencies) {
  const { code } = await transform(readFileSync(path, 'utf8'), { loader: 'jsx', format: 'cjs' });
  const scope = { exports: {} };
  runInNewContext(code, { React, module: scope, exports: scope.exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return scope.exports;
}
function pendingOffer() {
  const controller = createTripBubbleHandoff({ availability: async () => ({ available: true }) });
  return controller.offer(() => true);
}

describe('actual startup and session cleanup handlers', () => {
  it('invalidates and awaits startup removal before mounting the navigator', async () => {
    const h = hooks(), hidden = deferred(), calls = [];
    const dependencies = {
      react: h.react, 'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, View: 'View' },
      'expo-router': { Stack: 'Stack' }, 'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-font': { useFonts: () => [true, null] },
      'expo-splash-screen': { preventAutoHideAsync: async () => {}, hideAsync: async () => {} },
      '../lib/auth': { AuthProvider: 'AuthProvider' }, '../lib/notifications/push': {}, '../components/error-boundary': {},
      '../lib/theme-context': {}, '../lib/settings-context': {}, '../lib/sync': {}, '../components/AppAlert': {},
      '../components/NotificationHost': {}, '../components/LaunchScreen': {}, '../lib/launch': {},
      '../lib/trip-bubble': { hideTripBubble: () => { calls.push('hide'); invalidateTripBubbleWork(); return hidden.promise; } },
    };
    for (const name of ['PlusJakartaSans_400Regular', 'PlusJakartaSans_500Medium', 'PlusJakartaSans_600SemiBold', 'PlusJakartaSans_700Bold']) {
      dependencies[`@expo-google-fonts/plus-jakarta-sans/${name.split('_')[1]}`] = { [name]: 1 };
    }
    for (const name of ['IBMPlexMono_500Medium', 'IBMPlexMono_600SemiBold']) dependencies[`@expo-google-fonts/ibm-plex-mono/${name.split('_')[1]}`] = { [name]: 1 };
    const { default: Root } = await component('mobile/app/_layout.js', dependencies);
    const pending = pendingOffer();
    expect(h.render(Root)).toBeNull(); h.effects.splice(0).forEach(effect => effect());
    expect(calls).toEqual(['hide']); expect(await pending).toBe(false);
    expect(h.render(Root)).toBeNull(); hidden.resolve(); await flush();
    expect(h.render(Root)?.type).toBe('AuthProvider');
  });
  it.each(['logout', 'expired', 'signin'])('invalidates pending work at %s before asynchronous session work', async kind => {
    const h = hooks(), wait = deferred(); let expired;
    const dependencies = {
      react: h.react, 'react-native': { AppState: { currentState: 'background', addEventListener: () => ({ remove() {} }) } },
      '@react-native-community/netinfo': { default: { addEventListener: () => () => {} }, __esModule: true },
      './api': { apiFetch: async () => { await wait.promise; return { driver: { employeeId: 23 } }; }, setSessionExpiredHandler: fn => { expired = fn; } },
      './storage': { clearLegacyBiometricEnrollment: async () => {}, getRefreshToken: () => wait.promise, getUser: async () => ({ employeeId: 23 }), clearAll: async () => {} },
      './offline-cache': { clearOfflineCache: async () => {}, resolveDriverId: user => user?.employeeId },
      './notifications/device-token': { registerDeviceTokenIfAuthorized() {}, unregisterDeviceToken() {} },
      './cargo-sync': { setCargoSessionActor() {}, syncCargoDrafts: async () => {} }, './cargo-api': {},
      './auth-session': { getRestorableSignedInUser: async () => null, completeSignIn: async (data, setUser) => { setUser(data.driver); return data.driver; } },
      './trip-bubble': { hideTripBubble: async () => { invalidateTripBubbleWork(); } },
    };
    const { AuthProvider } = await component('mobile/lib/auth.js', dependencies);
    const state = h.render(() => AuthProvider({ children: null })).props.value;
    h.effects.splice(0).forEach(effect => effect()); await flush();
    let visible = false;
    const controller = createTripBubbleHandoff({ show: async () => { visible = true; } });
    const token = controller.arm(7, () => true);
    const pending = pendingOffer();
    const running = kind === 'logout' ? state.signOut() : kind === 'signin' ? state.signIn('driver', 'password') : expired();
    expect(await pending).toBe(false); wait.resolve(null); await running;
    controller.launched(token); controller.depart(); await flush(); expect(visible).toBe(false);
  });
});

describe('actual bubble redirect screen', () => {
  it.each([
    [{ user: null, loading: true }, null],
    [{ user: null, loading: false }, '/login'],
    [{ user: { role: 'staff' }, loading: false }, '/login'],
    [{ user: { role: 'driver', mustChangePassword: true }, loading: false }, '/set-password'],
    [{ user: { role: 'driver', employeeId: 23 }, loading: false }, '/(app)/(tabs)/map'],
  ])('waits for auth and returns only through the guarded current Map (%j)', async (auth, expected) => {
    const h = hooks(), hidden = deferred();
    const { default: RedirectTrip } = await component('mobile/app/redirect-trip.js', {
      react: h.react, 'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ tripId: '999' }) },
      '../lib/auth': { useAuth: () => auth }, '../lib/rbac': { isDriverSession }, '../lib/trip-deep-link': deepLink,
      '../lib/trip-bubble': { hideTripBubble: () => hidden.promise },
    });
    expect(h.render(RedirectTrip)).toBeNull(); h.effects.splice(0).forEach(effect => effect());
    hidden.resolve(); await flush();
    const rendered = h.render(RedirectTrip);
    if (!expected) expect(rendered).toBeNull();
    else {
      const href = rendered.props.href;
      expect(typeof href === 'string' ? href : href.pathname).toBe(expected);
      expect(JSON.stringify(href)).not.toContain('999');
      if (expected.endsWith('/map')) expect(href.params.bubbleReturn).toMatch(/^\d+$/);
    }
  });
});

describe('actual Map authoritative cleanup handlers', () => {
  const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8').replace(/\r\n/g, '\n');
  const trip = { trip_id: 7, trip_status: 'En Route' };
  function map(response = []) {
    let listener, visible = false, sessionCurrent = true;
    const shown = deferred();
    const activeTripRef = { current: trip };
    const controller = createTripBubbleHandoff({
      show: () => { visible = true; return shown.promise; }, hide: async () => { visible = false; },
      availability: async () => ({ available: true }),
    });
    const context = {
      useCallback: fn => fn, useEffect: fn => fn(), user: { employeeId: 23 }, profile: { driverType: 'Passenger' },
      captureCargoSession: () => ({}), isCurrentCargoSession: () => sessionCurrent,
      activeTripRef, tripBubbleRef: { current: controller }, tripRequest: { current: 0 },
      api: { get: vi.fn(async () => response) }, setTripSession: vi.fn(), setActiveTrip: vi.fn(),
      setNearbyTrips: vi.fn(), setRecentNotification: vi.fn(), prevTripIdsRef: { current: new Set() },
      setLoading: vi.fn(), samePayload: () => false, console: { warn() {} },
      isGpsTrackedTrip: value => value?.trip_status === 'En Route',
      subscribeApiEvents: fn => { listener = fn; }, setRouteData: vi.fn(), setRouteChoices: vi.fn(),
      updateLegContext: async () => {}, stopBackgroundTracking: async () => {},
    };
    const start = source.indexOf('  const loadTrip = useCallback');
    const end = source.indexOf('  useEffect(() => { loadTripRef', start);
    const loadTrip = runInNewContext(`${source.slice(start, end)}; loadTrip`, context);
    const eventStart = source.indexOf('  useEffect(() => subscribeApiEvents(event => {');
    const eventEnd = source.indexOf('  // `duty`', eventStart);
    runInNewContext(source.slice(eventStart, eventEnd), { ...context, loadTrip });
    return { context, controller, loadTrip, listener, visible: () => visible, shown, endSession: () => { sessionCurrent = false; }, arm() {
      const token = controller.arm(7, () => activeTripRef.current?.trip_id === 7 && activeTripRef.current?.trip_status === 'En Route');
      controller.launched(token); controller.depart();
    } };
  }
  it.each(['trip-completed', 'trip-cancelled'])('hides synchronously on matching %s with SHOW acknowledgement pending', async type => {
    const h = map(); h.arm(); expect(h.visible()).toBe(true);
    h.listener({ type, tripId: '7' });
    expect(h.visible()).toBe(false); h.shown.resolve({ shown: false }); await flush();
    expect(h.visible()).toBe(false); expect(h.context.activeTripRef.current).toBeNull();
  });
  it.each(['replacement', 'ended', 'failed'])('invalidates the shortcut as soon as canonical reload is %s', async kind => {
    const h = map(kind === 'replacement' ? [{ trip_id: 8, trip_status: 'En Route' }] : []); h.arm();
    if (kind === 'failed') h.context.api.get.mockRejectedValue(new Error('offline'));
    await h.loadTrip(); expect(h.visible()).toBe(false);
    if (kind === 'replacement') expect(h.context.activeTripRef.current.trip_id).toBe(8);
    expect(h.context.api.get).toHaveBeenCalledWith('/api/mobile/driver/trips');
    h.shown.resolve({ shown: false });
  });
  it('does not let an obsolete session reload remove the current shortcut', async () => {
    const reply = deferred(), h = map(); h.context.api.get.mockImplementation(() => reply.promise); h.arm();
    const pending = h.loadTrip(); h.endSession(); reply.resolve([]); await pending;
    expect(h.visible()).toBe(true); h.shown.resolve({ shown: true });
  });
  it('refreshes through the established focus handler even when a prior empty-state parameter remains', () => {
    const loadTrip = vi.fn();
    const start = source.indexOf('  useFocusEffect(useCallback(() => {\n    focusedRef.current = true;');
    const end = source.indexOf('  // Auto-polling', start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    runInNewContext(source.slice(start, end), {
      useFocusEffect: fn => fn(), useCallback: fn => fn, focusedRef: { current: false }, lastFixRef: { current: null },
      emptyStateKey: 'off-duty', params: { bubbleReturn: '123' }, loadTrip, dutyRefresh: null,
    });
    expect(loadTrip).toHaveBeenCalledOnce();
  });
});
