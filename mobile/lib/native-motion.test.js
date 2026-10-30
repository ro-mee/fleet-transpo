import { it, expect, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';

function animated() {
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate() { return this.value; } }
  const motion = () => ({ start: vi.fn(), stop: vi.fn() });
  return { Value, View: 'AnimatedView', timing: vi.fn(motion), spring: vi.fn(motion), sequence: vi.fn(motion), loop: vi.fn(motion), parallel: vi.fn(motion), delay: vi.fn(motion) };
}
it('keeps the decorative radar static when reduced motion is enabled', async () => {
  const Animated = animated();
  const h = await nativeRender(new URL('../components/RadarPulse.jsx', import.meta.url), { deps: { 'react-native': { ...nativeViews, Animated }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../lib/use-reduced-motion': { useReducedMotion: () => true } } });
  await h.flushEffects();
  expect(Animated.loop).not.toHaveBeenCalled();
  expect(h.nodes().filter(n => n.component === 'AnimatedView')).toHaveLength(0);
});
it('changes theme without LayoutAnimation under reduced motion', async () => {
  const configureNext = vi.fn();
  const h = await nativeRender(new URL('./theme-context.js', import.meta.url), { name: 'ThemeProvider', deps: {
    'react-native': { ...nativeViews, useColorScheme: () => 'dark', UIManager: {}, LayoutAnimation: { configureNext, Presets: { easeInEaseOut: {} } } },
    './settings-context': { useSettings: () => ({ settings: { colorScheme: 'dark' }, updateSetting: vi.fn() }) },
    './theme': { palettes: { dark: {} }, typeFor: () => ({}), statusSurfaces: () => ({}), elevationFor: () => ({}), m3: () => ({}) },
    './use-reduced-motion': { useReducedMotion: () => true },
  } });
  h.result.props.value.setColorScheme('light');
  h.result.props.value.toggleColorScheme();
  expect(configureNext).not.toHaveBeenCalled();
});
it('notifications share the reduced-motion preference and keep both entrances still', async () => {
  vi.useFakeTimers();
  const Animated = animated(); let publish;
  const h = await nativeRender(new URL('../components/NotificationHost.jsx', import.meta.url), { name: 'NotificationHost', deps: {
    'react-native': { ...nativeViews, Animated, AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) } },
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-router': { useRouter: () => ({ push() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '../lib/theme-context': nativeTheme,
    '../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../lib/scaling': { moderateScale: n => n },
    '../lib/notifications/notify': { subscribeNotificationHost: fn => { publish = fn; return () => {}; }, notify: {} },
    '../lib/notifications/push': { subscribePushResponses: () => () => {} }, '../lib/notifications/navigation': { mobileNotificationTarget: () => null },
    '../lib/use-reduced-motion': { useReducedMotion: () => true },
  } });
  await h.flushEffects();
  publish({ type: 'headsUp', payload: { title: 'Warning' } });
  publish({ type: 'toast', payload: { message: 'Saved' } }); h.render();
  const children = h.nodes().filter(n => typeof n.component === 'function');
  expect(children).toHaveLength(2);
  for (const child of children) { expect(child.props.reduceMotion).toBe(true); child.component(child.props); }
  await h.flushEffects();
  expect(Animated.spring).not.toHaveBeenCalled();
  expect(Animated.timing).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2799); h.render();
  expect(h.nodes().filter(n => typeof n.component === 'function')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); h.render();
  expect(h.nodes().filter(n => typeof n.component === 'function')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5200); h.render();
  expect(h.nodes().filter(n => typeof n.component === 'function')).toHaveLength(0);
  h.unmount(); vi.useRealTimers();
});
