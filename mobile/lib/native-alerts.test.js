import { it, expect, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';

function animations() {
  const calls = [];
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate() { return this.value; } }
  const Animated = { Value, View: 'AnimatedView', timing: vi.fn(() => ({})), spring: vi.fn(() => ({})), parallel: () => ({ start: fn => { if (fn) calls.push(fn); } }) };
  return { Animated, calls };
}
async function alertHarness(reduced = true) {
  const animation = animations();
  const h = await nativeRender(new URL('../components/AppAlert.js', import.meta.url), { name: 'AppAlertHost', deps: {
    'react-native': { ...nativeViews, Animated: animation.Animated, Platform: { select: () => ({}), OS: 'android' }, useWindowDimensions: () => ({ width: 320, height: 640, fontScale: 2 }) },
    '@expo/vector-icons': { Ionicons: 'Icon' }, '../lib/theme-context': nativeTheme, '../lib/theme': { fonts: {} },
    '../lib/use-reduced-motion': { useReducedMotion: () => reduced }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
  } });
  await h.flushEffects();
  return { h, ...animation };
}
it('shows long alerts with scroll recovery and growing wrapped actions, without spatial motion when reduced', async () => {
  const { h, Animated } = await alertHarness();
  h.exports.AppAlert.alert('Recovery', 'Long message '.repeat(100), [{ text: 'Retry with the current assignment' }, { text: 'Return to the current trip' }, { text: 'Cancel' }]); h.render();
  expect(h.find(n => n.component === 'ScrollView')).toBeDefined();
  expect(Animated.spring).not.toHaveBeenCalled();
  expect(Animated.timing).not.toHaveBeenCalled();
  const buttons = h.nodes().filter(n => n.component === 'Pressable');
  expect(buttons).toHaveLength(3);
  for (const button of buttons) {
    const style = Object.assign({}, ...button.props.style({ pressed: false }).filter(Boolean));
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  }
  expect(h.nodes().filter(n => n.component === 'Text').every(n => !n.props.numberOfLines)).toBe(true);
});
it('handles replacement, repeated button presses and Back with each callback at most once', async () => {
  const { h } = await alertHarness();
  const oldDismiss = vi.fn(), onPress = vi.fn(), onDismiss = vi.fn();
  h.exports.AppAlert.alert('Old', '', [], { onDismiss: oldDismiss }); h.render();
  h.exports.AppAlert.alert('New', '', [{ text: 'Continue', onPress }], { onDismiss }); h.render();
  expect(oldDismiss).toHaveBeenCalledOnce();
  const press = h.find(n => n.component === 'Pressable').props.onPress;
  press(); press();
  expect(onPress).toHaveBeenCalledOnce(); expect(onDismiss).toHaveBeenCalledOnce();
  h.exports.AppAlert.alert('Back', '', [], { onDismiss }); h.render();
  const back = h.find(n => n.component === 'Modal').props.onRequestClose;
  back(); back(); expect(onDismiss).toHaveBeenCalledTimes(2);
});
it('ignores an old animated dismissal after a replacement alert', async () => {
  const { h, calls } = await alertHarness(false);
  const firstPress = vi.fn(), firstDismiss = vi.fn(), newPress = vi.fn();
  h.exports.AppAlert.alert('First', '', [{ text: 'First', onPress: firstPress }], { onDismiss: firstDismiss }); h.render();
  h.find(n => n.component === 'Pressable').props.onPress();
  h.exports.AppAlert.alert('Replacement', '', [{ text: 'New', onPress: newPress }]); h.render();
  calls.shift()();
  expect(firstPress).not.toHaveBeenCalled(); expect(firstDismiss).toHaveBeenCalledOnce();
  h.find(n => n.component === 'Pressable').props.onPress(); calls.shift()();
  expect(newPress).toHaveBeenCalledOnce();
});
