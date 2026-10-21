import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { validateCompletionReading } from './trip-completion';
import { resolveDriverWorkspace } from './driver-workspace';
import * as presentation from './load-presentation';

const { code } = await transform(readFileSync(new URL('../app/(app)/trip/complete.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
const base = { trip_id: 7, trip_status: 'Drop-off', load_type: 'Passenger', operational_use: 'Passenger', vehicle_id: 2, current_mileage: 1000, start_odometer: 990, origin: 'Pickup', destination: 'Hotel' };
function render({ reading = '1010', offline = false, mismatch = false, cargo = false, result = null, override = false, reason = '', freshMileage = 1000, status = 'Drop-off', required = false } = {}) {
  const trip = { ...base, trip_status: status, odometer_capture_required: required, load_type: cargo ? 'Cargo' : 'Passenger', operational_use: mismatch ? 'Cargo' : cargo ? 'Cargo' : 'Passenger' };
  const session = { actorId: 10 };
  const values = [trip, session, false, false, reading, reason, override, null, result];
  const updates = [];
  let stateIndex = 0;
  let alive = true;
  const elements = [];
  const api = { get: vi.fn().mockImplementation(async path => path.includes('destination-check') ? { state: 'inside' } : [{ ...trip, current_mileage: freshMileage }]), put: vi.fn().mockResolvedValue({ trip_status: 'Completed' }) };
  const gate = vi.fn().mockResolvedValue({ allowed: true });
  const stop = vi.fn().mockResolvedValue(undefined);
  const context = vi.fn().mockResolvedValue(undefined);
  const stubReact = { ...React, useState: initial => { const index = stateIndex++; return [index < values.length ? values[index] : initial, value => updates.push({ index, value })]; }, useEffect: () => {}, useCallback: fn => fn, useRef: current => ({ current }), createElement: (component, props, ...children) => { const node = { component, props: props || {}, children }; elements.push(node); return node; } };
  const native = { View: 'View', Text: 'Text', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, StyleSheet: { create: x => x } };
  const deps = {
    react: stubReact, 'react-native': native, 'expo-router': { useFocusEffect: () => {}, useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }), useLocalSearchParams: () => ({ tripId: '7', needsOverride: override ? '1' : undefined }) },
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 16 }) },
    '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../../../lib/api': { api, apiFetch: path => path.includes('driver/me') ? Promise.resolve({ driverType: cargo ? 'Cargo' : 'Passenger' }) : api.get(path), wasQueued: res => res?.queued === true },
    '../../../lib/auth': { useAuth: () => ({ user: { employeeId: 10 } }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: offline ? 'offline' : 'online' }) },
    '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: { driverType: cargo ? 'Cargo' : 'Passenger' }, serverConfirmed: true }) },
    '../../../lib/cargo-sync': { captureCargoSession: () => session, isCurrentCargoSession: () => alive, getCargoSyncState: vi.fn() },
    '../../../lib/driver-workspace': { resolveDriverWorkspace }, '../../../lib/cargo-view-model': { resolveCargoMapGate: gate, workspaceBlockReason: () => 'Assignment mismatch' },
    '../../../lib/cargo-api': { cargoApi: { getExecution: vi.fn() } }, '../../../lib/load-presentation': presentation,
    '../../../lib/trip-completion': { validateCompletionReading }, '../../../lib/background-tracking': { stopBackgroundTracking: stop, updateLegContext: context },
    '../../../lib/use-trip-odometer': { useTripOdometer: props => ({ phase: 'review', reading: 1010, onConfirm: () => props.onConfirm('capture-7') }) },
    '../../../lib/trip-odometer': { odometerRequestOptions: () => ({ queueOnFailure: false, cargoActorId: 10 }), odometerApi: { read: vi.fn().mockResolvedValue({ state: 'committed', stage: 'end' }) } },
    '../../../components/trips/OdometerCapture': { default: 'Capture', __esModule: true },
    '../../../components/ClayScreenHeader': { default: 'Header', __esModule: true }, '../../../components/clay': { ClayCard: 'Card', ClayButton: 'Button', ClayInput: 'Input', ClayBadge: 'Badge' },
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  scope.exports.default();
  return { elements, updates, api, gate, stop, context, expire: () => { alive = false; }, complete: elements.find(node => node.props.label === 'Complete trip')?.props.onPress || elements.find(node => node.component === 'Capture')?.props.onConfirm };
}

describe('real completion form interactions', () => {
  it.each([false, true])('uses the shared camera for required Cargo=%s completion without a manual reading', async cargo => {
    const h = render({ required: true, cargo, reading: '' });
    expect(h.elements.find(node => node.component === 'Header').props.title).toBe('Ending odometer');
    expect(h.elements.some(node => node.component === 'Capture')).toBe(true);
    expect(h.elements.some(node => node.props.label === 'Ending odometer (km) *')).toBe(false);
    await h.complete();
    expect(h.api.put).toHaveBeenCalledWith('/api/trips/7/complete', { odometer_capture_id: 'capture-7' }, expect.objectContaining({ queueOnFailure: false, cargoActorId: 10 }));
    expect(h.stop).toHaveBeenCalledOnce();
  });
  it('retains required evidence and tracking when receiver authority rejects completion', async () => {
    const h = render({ required: true, cargo: true });
    h.gate.mockResolvedValueOnce({ allowed: false, reason: 'Receiver confirmation required' });
    await expect(h.complete()).rejects.toThrow('Receiver confirmation required');
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });
  it('does not stop tracking for a queued required-photo completion', async () => {
    const h = render({ required: true }); h.api.put.mockResolvedValueOnce({ queued: true });
    await h.complete(); expect(h.stop).not.toHaveBeenCalled();
    expect(h.updates).toContainEqual({ index: 8, value: 'queued' });
  });
  it('shows a blank required input, Cancel and no premature completion claim', () => {
    const h = render({ reading: '' });
    expect(h.elements.find(node => node.props.label === 'Ending odometer (km) *').props.value).toBe('');
    expect(h.elements.some(node => node.props.label === 'Cancel')).toBe(true);
    expect(h.elements.some(node => node.props.text === 'Completed')).toBe(false);
  });
  it('submits the actual reading once and releases tracking only after confirmation', async () => {
    const h = render();
    await Promise.all([h.complete(), h.complete()]);
    expect(h.api.put).toHaveBeenCalledTimes(1);
    expect(h.api.put).toHaveBeenCalledWith('/api/trips/7/complete', { end_odometer: 1010 }, expect.objectContaining({ queueOnFailure: false, cargoActorId: 10 }));
    expect(h.updates).toContainEqual({ index: 8, value: 'confirmed' });
    expect(h.stop).toHaveBeenCalledOnce();
  });
  it.each([{ offline: true }, { mismatch: true }, { status: 'Trip Started' }, { reading: '999' }, { reading: '0' }])('blocks unavailable or invalid completion %o', async options => {
    const h = render(options);
    await h.complete();
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });
  it('rechecks fresh mileage without replacing the typed reading', async () => {
    const h = render({ freshMileage: 1020 });
    await h.complete();
    expect(h.api.put).not.toHaveBeenCalled();
    expect(h.updates.some(update => update.index === 7 && String(update.value).includes('1020'))).toBe(true);
    expect(h.updates.some(update => update.index === 4)).toBe(false);
  });
  it('holds cargo without fresh server-confirmed delivery authority', async () => {
    const h = render({ cargo: true });
    h.gate.mockResolvedValueOnce({ allowed: false, reason: 'Receiver confirmation required' });
    await h.complete();
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
    expect(h.updates).toContainEqual({ index: 7, value: 'Receiver confirmation required' });
  });
  it('requires deliberate geofence override and a reason', async () => {
    const h = render();
    h.api.get.mockImplementation(async path => path.includes('destination-check') ? { state: 'outside' } : [base]);
    await h.complete();
    expect(h.api.put).not.toHaveBeenCalled();
    expect(h.updates).toContainEqual({ index: 6, value: true });
    const override = render({ override: true, reason: 'Dispatch approved this location' });
    await override.complete();
    expect(override.api.put.mock.calls[0][1]).toMatchObject({ geofence_override: true, completion_reason: 'Dispatch approved this location' });
    const blank = render({ override: true });
    await blank.complete(); expect(blank.api.put).not.toHaveBeenCalled();
  });
  it('retains the active trip and avoids success for queued or failed writes', async () => {
    const h = render();
    h.api.put.mockResolvedValueOnce({ queued: true });
    await h.complete(); expect(h.updates).toContainEqual({ index: 8, value: 'queued' }); expect(h.stop).not.toHaveBeenCalled();
    const failed = render(); failed.api.put.mockRejectedValueOnce(new Error('Connection lost'));
    await failed.complete(); expect(failed.stop).not.toHaveBeenCalled(); expect(failed.updates).toContainEqual({ index: 7, value: 'Connection lost' });
  });
  it('never writes after the authenticated session changes during a read', async () => {
    const h = render();
    h.api.get.mockImplementationOnce(async () => { h.expire(); return [base]; });
    await h.complete(); expect(h.api.put).not.toHaveBeenCalled();
  });
});
