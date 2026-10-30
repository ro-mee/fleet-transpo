import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace';

async function harness({ action = 'onboard', status = 'At Pickup', online = true, queued = false } = {}) {
  let cursor = 0, refCursor = 0, live = true, pendingResolve;
  const state = [], refs = [], nodes = [], effects = [];
  const session = { actorId: '9', signal: new AbortController().signal };
  const router = { replace: vi.fn(), back: vi.fn() }, alerts = [];
  const trip = { trip_id: 701, driver_id: 9, vehicle_id: 5, operational_use: 'Passenger', load_type: 'Passenger', trip_status: status };
  const api = { get: vi.fn(async path => path === '/api/driver/me' ? { driverType: 'Passenger' } : [trip]), put: vi.fn(async () => queued ? { queued: true } : {}) };
  const react = { ...React, useState: initial => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef: initial => refs[refCursor++] ||= { current: initial }, useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn), useCallback: fn => fn, createElement: (component, props, ...children) => { const node = { component, props: props || {}, children }; nodes.push(node); return node; } };
  const deps = { react, 'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', StyleSheet: { create: x => x } }, 'expo-router': { useLocalSearchParams: () => ({ tripId: '701', action, needsEnroute: '0' }), useRouter: () => router }, '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../../../lib/theme': { fonts: {} }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '../../../components/AppAlert': { AppAlert: { alert: (...args) => alerts.push(args) } }, '../../../components/clay': { ClayButton: 'Button', ClayCard: 'Card', ClayTile: 'Tile', ClayInput: 'Input' }, '../../../lib/api': { api, wasQueued: x => x?.queued }, '../../../lib/auth': { useAuth: () => ({ user: { employeeId: 9 } }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: online ? 'online' : 'offline' }) }, '../../../lib/cargo-sync': { captureCargoSession: () => session, isCurrentCargoSession: () => live }, '../../../lib/driver-workspace': { resolveDriverWorkspace } };
  const code = (await transform(readFileSync(new URL('../app/(app)/trip/override.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} }; runInNewContext(code, { React: react, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  const render = () => { cursor = refCursor = 0; nodes.length = 0; scope.exports.default(); };
  const button = () => nodes.find(n => n.component === 'Button' && n.props.variant === 'danger');
  render(); effects.splice(0).forEach(fn => fn()); nodes.find(n => n.component === 'Input').props.onChangeText('Gate access closed'); render();
  return { api, router, alerts, button, render, nodes, invalidate: () => { live = false; }, deferRead: () => api.get.mockImplementationOnce(() => new Promise(resolve => { pendingResolve = resolve; })), resolveRead: () => pendingResolve([trip]) };
}
describe('actual arrival override callback', () => {
  it('refuses an invalid action', async () => { const h = await harness({ action: 'anything' }); await h.button().props.onPress(); expect(h.api.put).not.toHaveBeenCalled(); expect(h.router.replace).not.toHaveBeenCalled(); });
  it('refuses offline updates', async () => { const h = await harness({ online: false }); await h.button().props.onPress(); expect(h.api.put).not.toHaveBeenCalled(); });
  it('rechecks the owned trip state before writing', async () => { const h = await harness({ status: 'Completed' }); await h.button().props.onPress(); expect(h.api.put).not.toHaveBeenCalled(); });
  it('does not chain or navigate after a queued acknowledgment', async () => { const h = await harness({ queued: true }); await h.button().props.onPress(); expect(h.api.put).toHaveBeenCalledTimes(1); expect(h.api.put.mock.calls[0][2]).toMatchObject({ queueOnFailure: false, cargoActorId: '9' }); expect(h.router.replace).not.toHaveBeenCalled(); h.render(); expect(h.nodes.find(n => n.component === 'Input').props.value).toBe('Gate access closed'); });
  it('rejects a stale session before a write', async () => { const h = await harness(); h.invalidate(); await h.button().props.onPress(); expect(h.api.put).not.toHaveBeenCalled(); });
  it('ignores a late exact-trip read after the session changes', async () => {
    const h = await harness(); h.deferRead(); const pending = h.button().props.onPress(); h.invalidate(); h.resolveRead(); await pending;
    expect(h.api.put).not.toHaveBeenCalled(); expect(h.router.replace).not.toHaveBeenCalled();
  });
  it('locks a duplicate confirmation while the fresh read is pending', async () => {
    const h = await harness(); h.deferRead(); const callback = h.button().props.onPress; const pending = callback(); await callback(); h.resolveRead(); await pending;
    expect(h.api.put).toHaveBeenCalledTimes(2); expect(h.router.replace).toHaveBeenCalledTimes(1);
  });
  it('stops before the dependent leg after a session change during pickup', async () => {
    const h = await harness(); h.api.put.mockImplementationOnce(async () => { h.invalidate(); return {}; }); await h.button().props.onPress();
    expect(h.api.put).toHaveBeenCalledTimes(1); expect(h.router.replace).not.toHaveBeenCalled();
  });
  it('uses fresh profile and exact-trip reads then confirms both online transitions', async () => { const h = await harness(); await h.button().props.onPress(); expect(h.api.get.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['/api/driver/me', '/api/mobile/driver/trips?trip_id=701'])); expect(h.api.put.mock.calls.map(c => c[0])).toEqual(['/api/trips/701/onboard', '/api/trips/701/enroute']); expect(h.router.replace).toHaveBeenCalledWith('/(app)/(tabs)/map'); });
});