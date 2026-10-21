import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

// Run the actual JSX/hooks, with native boundaries replaced by inspectable nodes.
function hooks() {
  const state = [], refs = [], effects = [], focus = [];
  let cursor = 0, refCursor = 0, effectCursor = 0;
  const effectDeps = [], effectCleanups = [];
  const react = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef(initial) { return refs[refCursor++] ||= { current: initial }; }, useCallback: fn => fn, useMemo: fn => fn(), useEffect(fn, deps) { const i = effectCursor++; if (!effectDeps[i] || deps?.some((d, j) => d !== effectDeps[i][j])) { effectDeps[i] = deps; effects.push(() => { effectCleanups[i]?.(); effectCleanups[i] = fn(); }); } }, createElement: (component, props, ...children) => ({ component, props: props || {}, children }) };
  return { react, focus, effects, render(fn) { cursor = refCursor = effectCursor = 0; return fn(); } };
}
async function evaluate(path, deps, globals = {}) {
  const code = (await transform(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} };
  runInNewContext(code, { React: deps.react || React, module: scope, exports: scope.exports, Date, Math, console, setTimeout, clearTimeout, setInterval, clearInterval, ...globals, require: name => { if (!deps[name]) throw Error(`Missing ${name}`); return deps[name]; } });
  return scope.exports;
}
async function draftHarness() {
  const h = hooks();
  const controller = new AbortController();
  const session = { actorId: '10', signal: controller.signal };
  let id = 0;
  const record = (captureId = 'capture-1', state = 'ready') => ({ capture_id: captureId, trip_id: 7, stage: 'start', state, unit: 'km', reading_km: 1000, uploaded_at: new Date().toISOString() });
  const api = { upload: vi.fn().mockResolvedValue(record('capture-1', 'uploaded')), scan: vi.fn().mockResolvedValue(record()), read: vi.fn().mockResolvedValue(record()) };
  const helper = await evaluate('./trip-odometer.js', { './api': {}, './cargo-sync': { isCurrentCargoSession: s => !s?.signal.aborted } }, { FormData });
  const { useTripOdometer } = await evaluate('./use-trip-odometer.js', { react: h.react, './cargo-sync': { isCurrentCargoSession: s => !s?.signal.aborted }, './trip-odometer': { ...helper, odometerApi: api, newOdometerCaptureId: () => `capture-${++id}` } });
  const confirm = vi.fn().mockResolvedValue(undefined);
  let current;
  const render = () => { current = h.render(() => useTripOdometer({ tripId: 7, stage: 'start', session, disabledReason: null, onConfirm: confirm })); return current; };
  render(); h.effects.splice(0).forEach(fn => fn());
  return { api, confirm, controller, record, render, flushEffects: () => h.effects.splice(0).forEach(fn => fn()), get flow() { return current; } };
}
describe('shared odometer draft interactions', () => {
  it('has one shared capture surface and actual start screen', () => {
    expect(existsSync(new URL('../components/trips/OdometerCapture.jsx', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../app/(app)/trip/odometer.js', import.meta.url))).toBe(true);
  });
  it('uploads/scans once for duplicate taps, reviews the server reading, then confirms once', async () => {
    const h = await draftHarness();
    h.flow.onCapture({ uri: 'file://one' }); h.render();
    await Promise.all([h.flow.onRead(), h.flow.onRead()]); h.render();
    expect(h.api.upload).toHaveBeenCalledOnce(); expect(h.api.scan).toHaveBeenCalledOnce();
    expect(h.flow.phase).toBe('review'); expect(h.flow.reading).toBe(1000);
    await Promise.all([h.flow.onConfirm(), h.flow.onConfirm()]);
    expect(h.confirm).toHaveBeenCalledExactlyOnceWith('capture-1');
  });
  it('reconciles a lost upload on retry with the same ID and retake creates a fresh ID', async () => {
    const h = await draftHarness();
    h.api.upload.mockRejectedValueOnce(new Error('Connection lost'));
    h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render();
    expect(h.flow.phase).toBe('error');
    await h.flow.onRead(); h.render();
    expect(h.api.read).toHaveBeenCalledWith(7, 'capture-1', expect.anything());
    expect(h.api.upload).toHaveBeenCalledOnce();
    h.flow.onRetake(); h.render(); h.flow.onCapture({ uri: 'file://two' }); h.render();
    await h.flow.onRead();
    expect(h.api.upload.mock.calls[1][1]).toMatchObject({ captureId: 'capture-2', asset: { uri: 'file://two' } });
  });
  it('retains the image for scan failure and ignores a stale scan after account change', async () => {
    const h = await draftHarness();
    h.api.scan.mockRejectedValueOnce(new Error('Reading unavailable'));
    h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render();
    expect(h.flow.asset.uri).toBe('file://one'); expect(h.flow.error).toBe('Reading unavailable');
    h.api.read.mockImplementationOnce(async () => { h.controller.abort(); return h.record(); });
    await h.flow.onRead(); h.render();
    expect(h.flow.phase).toBe('camera'); expect(h.flow.asset).toBe(null);
    await h.flow.onConfirm(); expect(h.confirm).not.toHaveBeenCalled();
  });
  it('keeps an in-flight scan retryable and reconciles ready evidence with the same photo and ID', async () => {
    const h = await draftHarness();
    let finishScan;
    h.api.scan.mockImplementationOnce(() => new Promise(resolve => { finishScan = resolve; }));
    h.flow.onCapture({ uri: 'file://one' }); h.render();
    const pending = h.flow.onRead();
    await Promise.resolve();
    await h.flow.onRead();
    expect(h.api.scan).toHaveBeenCalledOnce();
    finishScan({ ...h.record('capture-1', 'scanning'), reading_km: null, unit: null }); await pending; h.render();
    expect(h.flow.phase).toBe('error'); expect(h.flow.retakeRequired).toBe(false);
    expect(h.flow.error).toMatch(/still.*reading|reading.*progress/i);
    expect(h.flow.asset.uri).toBe('file://one');
    h.api.read.mockResolvedValueOnce(h.record());
    await h.flow.onRead(); h.render();
    expect(h.flow.phase).toBe('review'); expect(h.flow.reading).toBe(1000);
    expect(h.api.read).toHaveBeenCalledWith(7, 'capture-1', expect.anything());
    expect(h.api.upload).toHaveBeenCalledOnce(); expect(h.api.scan).toHaveBeenCalledOnce();
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it.each(['missing reservation', 'reserved upload without object'])('retries the same immutable upload after %s', async failure => {
    const h = await draftHarness();
    h.api.upload.mockRejectedValueOnce(new Error('Upload connection lost'));
    h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render();
    if (failure === 'missing reservation') h.api.read.mockRejectedValueOnce(Object.assign(new Error('Capture not found'), { status: 409, code: 'ODOMETER_CAPTURE_MISMATCH' }));
    else h.api.read.mockResolvedValueOnce(h.record('capture-1', 'uploaded'));
    await h.flow.onRead(); h.render();
    expect(h.api.upload).toHaveBeenCalledTimes(2);
    expect(h.api.upload.mock.calls.map(call => call[1].captureId)).toEqual(['capture-1', 'capture-1']);
    expect(h.flow.phase).toBe('review');
  });
  it('uses dashboard-photo language for the existing multipart transport refusal', async () => {
    const h = await draftHarness();
    h.api.upload.mockRejectedValueOnce(new Error('Network request failed. Upload was not queued; retry when online.'));
    h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render();
    expect(h.flow.error).not.toContain('Receipt');
    expect(h.flow.error).toContain('Odometer photo');
  });
  it('keeps ready evidence after a failed transition without uploading or scanning again', async () => {
    const h = await draftHarness();
    h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render();
    h.confirm.mockRejectedValueOnce(new Error('Receiver confirmation required'));
    await h.flow.onConfirm(); h.render();
    expect(h.flow.phase).toBe('review'); expect(h.flow.error).toBe('Receiver confirmation required');
    await h.flow.onConfirm();
    expect(h.api.scan).toHaveBeenCalledOnce(); expect(h.confirm).toHaveBeenCalledTimes(2);
  });
  it('turns an expired review into a retake without a transition', async () => {
    vi.useFakeTimers();
    try {
      const h = await draftHarness();
      h.flow.onCapture({ uri: 'file://one' }); h.render(); await h.flow.onRead(); h.render(); h.flushEffects();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1); h.render();
      expect(h.flow.phase).toBe('error'); expect(h.flow.retakeRequired).toBe(true);
      expect(h.confirm).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe('actual odometer camera surface', () => {
  async function surface({ permission = { granted: false, canAskAgain: false }, phase = 'camera', ...props } = {}) {
    const h = hooks(); const settings = vi.fn(); const request = vi.fn(); let appState;
    const readPermission = vi.fn(async () => permission);
    const getPermission = vi.fn(async () => { const next = await readPermission(); permission = next; return next; });
    const native = Object.fromEntries(['View', 'Text', 'Image', 'ScrollView', 'Pressable', 'ActivityIndicator'].map(n => [n, n]));
    const deps = { '../coachmarks/DriverGuideTrigger': 'GuideTrigger', '../coachmarks': { CoachMarkTarget: 'Target' }, react: h.react, 'react-native': { ...native, AppState: { currentState: 'active', addEventListener: (_, fn) => { appState = fn; return { remove() {} }; } }, Linking: { openSettings: settings }, StyleSheet: { create: x => x } }, 'expo-router': { useFocusEffect: fn => h.focus.push(fn) }, 'expo-camera': { CameraView: 'Camera', useCameraPermissions: () => [permission, request, getPermission] }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 16 }) }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../clay': { ClayButton: 'Button' } };
    deps['./OdometerReview'] = await evaluate('../components/trips/OdometerReview.jsx', deps);
    const { default: Component } = await evaluate('../components/trips/OdometerCapture.jsx', deps);
    let root;
    const render = () => { root = h.render(() => Component({ stage: 'start', phase, onCancel: vi.fn(), ...props })); };
    render(); h.effects.splice(0).forEach(fn => fn()); const cleanup = h.focus[0]?.(); render();
    const nodes = () => { const out = []; const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (n?.component) { out.push(n); if (typeof n.component === 'function') walk(n.component(n.props)); else n.children.forEach(walk); } }; walk(root); return out; };
    return { nodes, settings, request, render, readPermission, getPermission, flushEffects: () => h.effects.splice(0).forEach(fn => fn()), background: () => appState('background'), foreground: () => appState('active'), blur: cleanup };
  }
  it('offers system settings when permission cannot be asked again', async () => {
    const h = await surface();
    h.nodes().find(n => n.props.label === 'Open settings').props.onPress();
    expect(h.settings).toHaveBeenCalledOnce(); expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
  });
  it('refreshes permission granted in Settings on the same mounted focused screen', async () => {
    const h = await surface(); h.flushEffects(); await Promise.resolve(); await Promise.resolve();
    h.nodes().find(n => n.props.label === 'Open settings').props.onPress();
    h.background(); h.render(); h.flushEffects(); h.getPermission.mockClear();
    h.readPermission.mockResolvedValueOnce({ granted: true, canAskAgain: true });
    h.foreground(); h.render(); h.flushEffects();
    await Promise.resolve(); await Promise.resolve(); h.render();
    expect(h.getPermission).toHaveBeenCalledOnce();
    expect(h.nodes().filter(n => n.component === 'Camera')).toHaveLength(1);
    expect(h.nodes().some(n => n.props.label === 'Open settings')).toBe(false);
  });
  it('ignores a deferred permission failure after blur and does not refresh a hidden screen', async () => {
    const h = await surface(); h.flushEffects(); await Promise.resolve(); await Promise.resolve();
    let rejectPermission;
    h.readPermission.mockImplementationOnce(() => new Promise((_, reject) => { rejectPermission = reject; }));
    h.background(); h.render(); h.flushEffects(); h.foreground(); h.render(); h.flushEffects();
    h.blur(); h.background(); h.render(); h.flushEffects(); h.getPermission.mockClear();
    h.foreground(); h.render(); h.flushEffects();
    expect(h.getPermission).not.toHaveBeenCalled();
    expect(rejectPermission).toBeTypeOf('function');
    rejectPermission(new Error('Permission read failed'));
    await Promise.resolve(); await Promise.resolve(); h.render();
    expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
    expect(h.nodes().some(n => n.props.accessibilityRole === 'alert')).toBe(false);
  });
  it('mounts one camera only while focused and foregrounded', async () => {
    const h = await surface({ permission: { granted: true } });
    expect(h.nodes().filter(n => n.component === 'Camera')).toHaveLength(1);
    h.background(); h.render(); expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
    h.blur(); h.render(); expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
  });
  it('shows full-frame review, the reading and a single explicit confirmation', async () => {
    const h = await surface({ phase: 'review', asset: { uri: 'file://one' }, reading: 25000 });
    expect(h.nodes().find(n => n.component === 'Image').props.resizeMode).toBe('contain');
    expect(h.nodes().some(n => n.props.label === 'Confirm and start route')).toBe(true);
    expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
  });
  it('keeps the in-progress scan Retry enabled while the same photo is retained', async () => {
    const onRead = vi.fn();
    const h = await surface({ phase: 'error', asset: { uri: 'file://one' }, retakeRequired: false, error: 'Reading is still in progress.', onRead });
    const retry = h.nodes().find(n => n.props.label === 'Retry');
    expect(retry.props.disabled).toBe(false);
    retry.props.onPress(); expect(onRead).toHaveBeenCalledOnce();
    expect(h.nodes().find(n => n.component === 'Image').props.source.uri).toBe('file://one');
  });
  it('ignores a deferred picture after blur, background and foreground', async () => {
    let resolvePhoto;
    const onCapture = vi.fn();
    const h = await surface({ permission: { granted: true }, onCapture });
    const camera = h.nodes().find(n => n.component === 'Camera');
    camera.props.ref.current = { takePictureAsync: () => new Promise(resolve => { resolvePhoto = resolve; }) };
    camera.props.onCameraReady(); h.render();
    const pending = h.nodes().find(n => n.props.label === 'Take odometer photo').props.onPress();
    h.blur(); h.background(); h.foreground(); h.render();
    resolvePhoto({ uri: 'file://late' }); await pending;
    expect(onCapture).not.toHaveBeenCalled();
    expect(h.nodes().some(n => n.component === 'Camera')).toBe(false);
  });
});

describe('actual start camera route', () => {
  async function startHarness({ tour, cargo = false, passed = true, accepted = false } = {}) {
    const h = hooks(); const controller = new AbortController(); const session = { actorId: '10', signal: controller.signal };
    const trip = { trip_id: 7, vehicle_id: 2, operational_use: cargo ? 'Cargo' : 'Passenger', load_type: cargo ? 'Cargo' : 'Passenger', trip_status: accepted ? 'Driver Accepted' : 'Assigned', pre_trip_status: passed ? 'Passed' : null, earliest_start: '2020-01-01', odometer_photo_required_at_start: true };
    const apiFetch = vi.fn(async path => path.includes('driver/me') ? { driverType: cargo ? 'Cargo' : 'Passenger' } : path.includes('/duty') ? { checkedIn: true } : [trip]);
    const api = { put: vi.fn(async path => { if (path.endsWith('/accept')) trip.trip_status = 'Driver Accepted'; return {}; }) };
    const router = { replace: vi.fn(), back: vi.fn() };
    let flowProps;
    const real = await evaluate('./trip-odometer.js', { './api': { apiFetch }, './cargo-sync': { isCurrentCargoSession: s => s && !s.signal.aborted } }, { FormData });
    const { resolveDriverWorkspace } = await import('./driver-workspace'); const { readinessFor } = await import('./trip-detail');
    const deps = { react: h.react, 'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', StyleSheet: { create: x => x } }, 'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({ tripId: '7', stage: 'start', tour }), useFocusEffect: fn => h.focus.push(fn) }, '../../../lib/api': { apiFetch, api, wasQueued: x => x?.queued === true }, '../../../lib/auth': { useAuth: () => ({ user: { employeeId: '10' } }) }, '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../../lib/cargo-sync': { captureCargoSession: () => session, isCurrentCargoSession: s => s && !s.signal.aborted, getCargoSyncState: vi.fn() }, '../../../lib/driver-workspace': { resolveDriverWorkspace }, '../../../lib/cargo-view-model': { resolveCargoMapGate: vi.fn().mockResolvedValue({ allowed: true }), workspaceBlockReason: () => 'Assignment mismatch' }, '../../../lib/cargo-api': { cargoApi: {} }, '../../../lib/trip-detail': { readinessFor }, '../../../lib/trips-queue': { PRE_START: ['Assigned', 'Driver Accepted'] }, '../../../lib/trip-odometer': real, '../../../lib/use-trip-odometer': { useTripOdometer: props => { flowProps = props; return { phase: 'review' }; } }, '../../../components/ClayScreenHeader': { default: 'Header', __esModule: true }, '../../../components/trips/OdometerCapture': { default: 'Capture', __esModule: true }, '../../../components/clay': { ClayButton: 'Button' }, '../../../components/coachmarks/LegacyGuideLinkGuard': { guardLegacyGuideLinks: Screen => Screen } };
    const { default: Screen } = await evaluate('../app/(app)/trip/odometer.js', deps);
    const render = () => h.render(() => Screen()); render();
    h.focus[0]?.(); await new Promise(resolve => setTimeout(resolve, 0)); render();
    return { apiFetch, api, trip, router, controller, flow: () => flowProps, render };
  }
  it.each([false, true])('accepts once then starts with only capture ID for Cargo=%s', async cargo => {
    const h = await startHarness({ cargo });
    await h.flow().onConfirm('capture-1');
    expect(h.api.put.mock.calls.map(c => c[0])).toEqual(['/api/trips/7/accept', '/api/trips/7/start']);
    expect(h.api.put.mock.calls[1][1]).toEqual({ odometer_capture_id: 'capture-1' });
    expect(h.api.put.mock.calls[1][2]).toMatchObject({ queueOnFailure: false, cargoActorId: '10', signal: h.controller.signal });
    expect(h.router.replace).toHaveBeenCalledWith('/(app)/(tabs)/map');
  });
  it('skips duplicate acceptance and redirects missing inspection with continuation', async () => {
    const h = await startHarness({ accepted: true }); await h.flow().onConfirm('capture-1');
    expect(h.api.put.mock.calls.map(c => c[0])).toEqual(['/api/trips/7/start']);
    const missing = await startHarness({ passed: false });
    expect(missing.router.replace).toHaveBeenCalledWith({ pathname: '/inspection', params: { tripId: '7', continuation: 'odometer-start' } });
    expect(missing.api.put).not.toHaveBeenCalled();
  });
  it('performs no practice network calls and refuses stale account transitions', async () => {
    const tour = await startHarness({ tour: '1' }); expect(tour.apiFetch).not.toHaveBeenCalled();
    const stale = await startHarness(); stale.controller.abort(); await stale.flow().onConfirm('capture-1');
    expect(stale.api.put).not.toHaveBeenCalled();
  });
});
