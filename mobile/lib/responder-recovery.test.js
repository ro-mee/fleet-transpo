import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
const code = (await transform(readFileSync(new URL('./responder-action.js', import.meta.url), 'utf8'), { format: 'cjs' })).code;
function actionHarness(api) {
  const scope = { exports: {} }; let validSession = true;
  runInNewContext(code, { exports: scope.exports, module: scope, require: key => key === './api' ? { api } : { captureCargoSession: actorId => ({ actorId }), isCurrentCargoSession: () => validSession } });
  return { run: scope.exports.runResponderAction, expire: () => { validSession = false; } };
}
it.each(['arrived', 'resolve'])('%s rereads and binds the expected incident, rejecting a different latest mission', async action => {
  const api = { get: vi.fn(async () => [{ incident_id: 22 }]), post: vi.fn(async () => ({ incident_id: 11 })) };
  const h = actionHarness(api), input = { incidentId: 11, actorId: 9, action, isCurrent: () => true };
  await expect(h.run(input)).rejects.toThrow('assignment changed'); expect(api.post).not.toHaveBeenCalled();
  api.get.mockResolvedValue([{ incident_id: 11 }]); await h.run(input);
  expect(api.post).toHaveBeenCalledWith(`/api/driver/responder/${action}`, { incident_id: 11 }, expect.objectContaining({ queueOnFailure: false, cargoActorId: 9 }));
});
it('does not write after session change during mission reread', async () => {
  const api = { get: vi.fn(), post: vi.fn() }; const h = actionHarness(api);
  api.get.mockImplementation(async () => { h.expire(); return [{ incident_id: 11 }]; });
  await expect(h.run({ incidentId: 11, actorId: 9, action: 'arrived', isCurrent: () => true })).rejects.toThrow('session');
  expect(api.post).not.toHaveBeenCalled();
});
it.each(['status', 'navigation'])('real stale %s mission arrival cannot mutate, then explicit Retry recovers', async screen => {
  let scheduled, polling; const alert = vi.fn();
  const get = vi.fn(async path => path.includes('role=responder') ? [{ incident_id: 11, response_status: 'Dispatched', description: 'Old mission', status: 'Open' }] : []);
  const post = vi.fn(async () => ({ incident_id: 11, response_status: 'Arrived' })); const action = actionHarness({ get, post });
  const h = await nativeRender(new URL(screen === 'status' ? '../app/(app)/incident/[id].js' : '../app/(app)/incident/navigate.js', import.meta.url), { globals: { setTimeout: fn => { scheduled = fn; return 1; }, setInterval: fn => { polling = fn; return 1; } }, deps: {
    'react-native': { ...nativeViews, RefreshControl: 'Refresh', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useLocalSearchParams: () => ({ id: '11' }), useRouter: () => ({ back() {} }), useFocusEffect: fn => { fn(); } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-location': { requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), getCurrentPositionAsync: async () => ({ coords: { latitude: 14, longitude: 121 } }), Accuracy: {}, watchPositionAsync: async () => ({ remove() {} }), watchHeadingAsync: async () => ({ remove() {} }) }, '../../../components/TomTomMap': 'Map', '../../../lib/clay': { clayMaterials: () => ({}) }, '../../../lib/external-navigation': {},
    '../../../lib/theme-context': nativeTheme, '../../../lib/theme': { fonts: {} }, '../../../lib/api': { api: { get, post } }, '../../../lib/auth': { useAuth: () => ({ user: { employeeId: 9 } }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../../lib/responder-action': { runResponderAction: action.run }, '../../../components/AppAlert': { AppAlert: { alert } }, '../../../components/clay': { ClayCard: 'Card', ClayButton: 'Button', ClayTile: 'Tile', ClayBadge: 'Badge' },
  } });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); h.render(); };
  await h.flushEffects(); scheduled(); await settle();
  const arrival = () => h.find(n => n.props.label === "I've arrived");
  expect(arrival()).toBeDefined(); const oldCallback = arrival().props.onPress;
  get.mockRejectedValueOnce(new Error('offline')); polling(); await settle();
  expect(arrival().props.disabled).toBe(true); await oldCallback(); expect(post).not.toHaveBeenCalled();
  await h.find(n => n.props.label === (screen === 'status' ? 'Retry incident status' : 'Retry mission')).props.onPress(); await settle();
  expect(arrival().props.disabled).toBe(false); await arrival().props.onPress();
  expect(post).toHaveBeenCalledOnce(); expect(post.mock.calls[0][1]).toEqual({ incident_id: 11 });
});
