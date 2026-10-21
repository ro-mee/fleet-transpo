import { afterEach, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';

let fontResult = [true, null];
const prevent = vi.fn(async () => {}), hide = vi.fn(async () => {}), initPush = vi.fn(async () => {});
const cancel = vi.fn(), tasks = [], complete = vi.fn(), subscriptions = [];
const fontModules = [
  ['plus-jakarta-sans/400Regular', 'PlusJakartaSans_400Regular'], ['plus-jakarta-sans/500Medium', 'PlusJakartaSans_500Medium'],
  ['plus-jakarta-sans/600SemiBold', 'PlusJakartaSans_600SemiBold'], ['plus-jakarta-sans/700Bold', 'PlusJakartaSans_700Bold'],
  ['ibm-plex-mono/500Medium', 'IBMPlexMono_500Medium'], ['ibm-plex-mono/600SemiBold', 'IBMPlexMono_600SemiBold'],
];
const deps = {
  'react-native': { ...nativeViews, AppState: { currentState: 'active', addEventListener: (_, fn) => { subscriptions.push(fn); return { remove: vi.fn() }; } }, InteractionManager: { runAfterInteractions: fn => { tasks.push(fn); return { cancel }; } } },
  'expo-router': { Stack: 'Stack' }, 'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-font': { useFonts: () => fontResult },
  'expo-splash-screen': { preventAutoHideAsync: prevent, hideAsync: hide },
  ...Object.fromEntries(fontModules.map(([path, name]) => [`@expo-google-fonts/${path}`, { [name]: name }])),
  '../lib/auth': { AuthProvider: 'AuthProvider' }, '../lib/settings-context': { SettingsProvider: 'SettingsProvider' },
  '../lib/theme-context': { ThemeProvider: 'ThemeProvider', useTheme: () => ({ scheme: 'light', colors: { background: '#F5F2EC' } }) },
  '../lib/notifications/push': { initPush }, '../lib/sync': { syncQueue: vi.fn(async () => {}) },
  '../lib/launch': { completeLaunch: complete }, '../components/error-boundary': { ErrorBoundary: 'ErrorBoundary' },
  '../components/AppAlert': { AppAlertHost: 'AppAlertHost' }, '../components/NotificationHost': { NotificationHost: 'NotificationHost' },
  '../components/LaunchScreen': { LaunchScreen: 'LaunchScreen' },
};
afterEach(() => { vi.clearAllMocks(); tasks.length = 0; subscriptions.length = 0; fontResult = [true, null]; });

it('holds the native splash until fonts settle and keeps the provider startup order', async () => {
  fontResult = [false, null];
  const h = await nativeRender(new URL('../app/_layout.js', import.meta.url), { deps });
  expect(prevent).toHaveBeenCalledOnce(); expect(h.result).toBeNull(); expect(hide).not.toHaveBeenCalled();
  fontResult = [false, new Error('font unavailable')]; h.render();
  expect(h.nodes().slice(0, 3).map(n => n.component)).toEqual(['AuthProvider', 'SettingsProvider', 'ThemeProvider']);
  expect(hide).not.toHaveBeenCalled();
  h.unmount();
});

it('hides native splash on a laid-out app shell and reveals the same navigator after launch', async () => {
  const done = vi.fn();
  const h = await nativeRender(new URL('../app/_layout.js', import.meta.url), { name: 'ThemedApp', props: { showLaunch: true, onLaunchDone: done }, deps });
  await h.flushEffects(); expect(hide).not.toHaveBeenCalled(); expect(tasks).toHaveLength(0);
  const stack = h.find(n => n.component === 'Stack'); expect(stack).toBeDefined();
  expect(h.find(n => n.props.importantForAccessibility === 'no-hide-descendants').props.pointerEvents).toBe('none');
  const layout = h.find(n => typeof n.props.onLayout === 'function');
  expect(layout).toBeDefined(); layout.props.onLayout(); layout.props.onLayout();
  expect(hide).toHaveBeenCalledOnce();
  h.find(n => n.component === 'LaunchScreen').props.onComplete(); expect(done).toHaveBeenCalledOnce();
  h.render({ showLaunch: false }); await h.flushEffects();
  expect(h.find(n => n.component === 'Stack').props.screenOptions).toEqual(stack.props.screenOptions);
  expect(h.find(n => n.component === 'LaunchScreen')).toBeUndefined();
  expect(h.find(n => n.props.importantForAccessibility === 'auto').props.pointerEvents).toBe('auto');
  expect(initPush).not.toHaveBeenCalled(); expect(tasks).toHaveLength(1);
  await tasks[0](); expect(initPush).toHaveBeenCalledOnce();
  h.unmount(); expect(cancel).toHaveBeenCalledOnce();
});

it('does not replay launch when returning from background or after rerender', async () => {
  const h = await nativeRender(new URL('../app/_layout.js', import.meta.url), { deps });
  await h.flushEffects();
  const app = () => h.nodes().find(n => typeof n.component === 'function' && n.component.name === 'ThemedApp');
  app().props.onLaunchDone(); app().props.onLaunchDone(); h.render();
  expect(app().props.showLaunch).toBe(false); expect(complete).toHaveBeenCalledOnce();
  subscriptions[0]('background'); subscriptions[0]('active'); h.render();
  expect(app().props.showLaunch).toBe(false); h.unmount();
});
