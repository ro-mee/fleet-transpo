import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace';
import { readinessFor } from './trip-detail';
import { validateCompletionReading } from './trip-completion';
import * as presentation from './load-presentation';

// Execute the real screens, draft hook and request wrapper; replace native and
// network boundaries so no provider or operating trip can be touched.
async function harness(stage, { commit = true, lateFailure = false } = {}) {
  const state = [], refs = [], deps = [], cleanups = [], effects = [], focus = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, root, connectivity = 'online';
  const react = {
    ...React,
    useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useEffect(fn, next) { const i = effectIndex++; if (!deps[i] || next?.some((value, j) => value !== deps[i][j])) { deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
    useCallback: fn => fn,
    createElement: (component, props, ...children) => ({ component, props: props || {}, children }),
  };
  async function evaluate(path, imports) {
    const { code } = await transform(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
    const scope = { exports: {} };
    class NativeFormData { values = new Map(); append(key, value) { this.values.set(key, value); } get(key) { return this.values.get(key); } }
    runInNewContext(code, { React: react, module: scope, exports: scope.exports, Date, Math, console, FormData: NativeFormData, setTimeout, clearTimeout, require: name => {
      if (!imports[name]) throw Error(`Missing ${name}`);
      return imports[name];
    } });
    return scope.exports;
  }
  const controller = new AbortController(), session = { actorId: '10', signal: controller.signal };
  const cargo = { captureCargoSession: () => session, isCurrentCargoSession: s => s === session && !s.signal.aborted, getCargoSyncState: vi.fn() };
  const trip = { trip_id: 7, vehicle_id: 2, operational_use: 'Passenger', load_type: 'Passenger', trip_status: stage === 'start' ? 'Driver Accepted' : 'Drop-off', pre_trip_status: 'Passed', earliest_start: '2020-01-01', odometer_photo_required_at_start: true, odometer_capture_required: true };
  let record, committed = false, rejectFirst;
  const apiFetch = vi.fn(async (path, options) => {
    if (path.includes('/odometer')) {
      if (path.endsWith('/odometer')) { record = { capture_id: options.body.get('capture_id'), trip_id: 7, stage, state: 'uploaded', unit: null, reading_km: null, uploaded_at: new Date().toISOString() }; return record; }
      const captureId = path.split('/odometer/')[1].split('/')[0];
      record.capture_id = captureId;
      if (path.endsWith('/scan')) { record = { ...record, state: 'ready', unit: 'km', reading_km: 1000 }; return record; }
      return { ...record, state: committed ? 'committed' : 'ready' };
    }
    if (path.includes('driver/me')) return { driverType: 'Passenger' };
    if (path.includes('/duty')) return { checkedIn: true };
    if (path.endsWith('/destination-check')) return { state: 'inside' };
    return [{ ...trip }];
  });
  const api = { put: vi.fn(async () => {
    if (api.put.mock.calls.length === 1) {
      if (commit) { committed = true; trip.trip_status = stage === 'start' ? 'Trip Started' : 'Completed'; }
      if (lateFailure) await new Promise((_, reject) => { rejectFirst = reject; });
      throw new Error('Connection lost after confirmation');
    }
    return { trip_status: trip.trip_status };
  }) };
  const helper = await evaluate('./trip-odometer.js', { './api': { apiFetch }, './cargo-sync': cargo });
  const hook = await evaluate('./use-trip-odometer.js', { react, './cargo-sync': cargo, './trip-odometer': helper });
  const router = { replace: vi.fn(), back: vi.fn() }, stop = vi.fn(async () => {}), leg = vi.fn(async () => {});
  const native = Object.fromEntries(['View', 'Text', 'ScrollView', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name]));
  const imports = {
    react, 'react-native': { ...native, Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({ tripId: '7', stage }), useFocusEffect: fn => focus.push(fn) },
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 16 }) },
    '../../../lib/api': { apiFetch, api, wasQueued: x => x?.queued === true },
    '../../../lib/auth': { useAuth: () => ({ user: { employeeId: '10' } }) },
    '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) },
    '../../../lib/connectivity-context': { useConnectivity: () => ({ status: connectivity }) },
    '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: { driverType: 'Passenger' }, serverConfirmed: true }) },
    '../../../lib/cargo-sync': cargo, '../../../lib/driver-workspace': { resolveDriverWorkspace },
    '../../../lib/cargo-view-model': { resolveCargoMapGate: async () => ({ allowed: true }), workspaceBlockReason: () => 'Assignment mismatch' },
    '../../../lib/cargo-api': { cargoApi: {} }, '../../../lib/trip-detail': { readinessFor },
    '../../../lib/trips-queue': { PRE_START: ['Assigned', 'Driver Accepted'] }, '../../../lib/trip-odometer': helper,
    '../../../lib/use-trip-odometer': hook, '../../../lib/load-presentation': presentation,
    '../../../lib/trip-completion': { validateCompletionReading }, '../../../lib/background-tracking': { stopBackgroundTracking: stop, updateLegContext: leg },
    '../../../components/ClayScreenHeader': { default: 'Header', __esModule: true },
    '../../../components/trips/OdometerCapture': { default: 'Capture', __esModule: true },
    '../../../components/clay': { ClayButton: 'Button', ClayCard: 'Card', ClayInput: 'Input', ClayBadge: 'Badge' },
    '../../../components/coachmarks/LegacyGuideLinkGuard': { guardLegacyGuideLinks: Screen => Screen },
  };
  const { default: Screen } = await evaluate(stage === 'start' ? '../app/(app)/trip/odometer.js' : '../app/(app)/trip/complete.js', imports);
  const render = () => { stateIndex = refIndex = effectIndex = 0; root = Screen(); effects.splice(0).forEach(fn => fn()); };
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } };
  const nodes = () => { const out = []; const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (n?.component) { out.push(n); n.children.forEach(walk); } }; walk(root); return out; };
  const flow = () => nodes().find(n => n.component === 'Capture')?.props;
  render(); focus[0](); await settle();
  flow().onCapture({ uri: 'file://dashboard.jpg' }); render(); await flow().onRead(); await settle();
  return { flow, nodes, render, settle, apiFetch, api, router, stop, leg, controller, record: () => record, reject: () => rejectFirst(new Error('Connection lost after confirmation')), offline: () => { connectivity = 'offline'; render(); }, dispose: () => cleanups.forEach(fn => fn?.()) };
}

afterEach(() => vi.useRealTimers());
describe('same-photo recovery through actual start/end screens and draft hook', () => {
  it.each(['start', 'end'])('acknowledges committed %s after a lost response and local expiry', async stage => {
    vi.useFakeTimers();
    const h = await harness(stage);
    try {
      await Promise.all([h.flow().onConfirm(), h.flow().onConfirm()]); await h.settle();
      expect(h.api.put).toHaveBeenCalledOnce(); expect(h.router.replace).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); await h.settle();
      expect(h.flow().retakeRequired).toBe(false);
      expect(h.flow().asset.uri).toBe('file://dashboard.jpg');
      expect(h.api.put).toHaveBeenCalledOnce();
      await Promise.all([h.flow().onRead(), h.flow().onRead()]); await h.settle();
      expect(h.api.put.mock.calls.map(call => call[1])).toEqual([{ odometer_capture_id: h.record().capture_id }, { odometer_capture_id: h.record().capture_id }]);
      expect(h.apiFetch.mock.calls.filter(([path]) => path.endsWith('/scan'))).toHaveLength(1);
      expect(h.apiFetch.mock.calls.filter(([path]) => path.endsWith('/odometer'))).toHaveLength(1);
      if (stage === 'start') expect(h.router.replace).toHaveBeenCalledExactlyOnceWith('/(app)/(tabs)/map');
      else { expect(h.nodes().some(n => n.component === 'Header' && n.props.title === 'Trip completed')).toBe(true); expect(h.stop).toHaveBeenCalledOnce(); expect(h.leg).toHaveBeenCalledExactlyOnceWith({ tripId: null, leg: null }); }
    } finally { h.dispose(); }
  });
  it.each(['start', 'end'])('recovers %s when the failed confirmation returns after expiry', async stage => {
    vi.useFakeTimers();
    const h = await harness(stage, { lateFailure: true });
    try {
      const pending = h.flow().onConfirm(); await h.settle();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); h.reject(); await pending; await h.settle();
      await vi.advanceTimersByTimeAsync(1); await h.settle();
      expect(h.flow().retakeRequired).toBe(false);
      await h.flow().onConfirm(); await h.settle();
      expect(h.api.put).toHaveBeenCalledTimes(2);
      if (stage === 'start') expect(h.router.replace).toHaveBeenCalledOnce(); else expect(h.stop).toHaveBeenCalledOnce();
    } finally { h.dispose(); }
  });
  it.each(['start', 'end'])('requires Retake for a genuinely uncommitted expired %s after explicit reconciliation', async stage => {
    vi.useFakeTimers();
    const h = await harness(stage, { commit: false });
    try {
      await h.flow().onConfirm(); await h.settle();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); await h.settle();
      expect(h.flow().retakeRequired).toBe(false);
      await h.flow().onRead(); await h.settle();
      expect(h.flow().retakeRequired).toBe(true);
      expect(h.api.put).toHaveBeenCalledOnce(); expect(h.router.replace).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
  it.each(['start', 'end'])('does not reconcile expired %s while offline or after account change', async stage => {
    vi.useFakeTimers();
    const h = await harness(stage);
    try {
      await h.flow().onConfirm(); await h.settle();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); await h.settle();
      h.offline(); const reads = h.apiFetch.mock.calls.length;
      await h.flow().onRead(); expect(h.apiFetch).toHaveBeenCalledTimes(reads);
      const staleConfirm = h.flow().onConfirm;
      h.controller.abort(); await h.settle(); await staleConfirm();
      expect(h.api.put).toHaveBeenCalledOnce(); expect(h.router.replace).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
});
