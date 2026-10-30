import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';

it('renders the new route composition once and connects cancellation, completion and failure correctly', async () => {
  const finish = vi.fn(), animationFailed = vi.fn(), audio = vi.fn();
  let reducedMotion = false, scheme = 'light', highContrast = false;
  const variants = ['light', 'dark', 'high-contrast-light', 'high-contrast-dark'];
  const assets = Object.fromEntries(variants.flatMap(v => [
    [`../assets/brand/route-reveal-${v}.json`, { w: 312, h: v === 'light' ? 648 : 630 }],
    [`../assets/brand/launch-${v}.png`, `final-${v}`],
  ]));
  const h = await nativeRender(new URL('../components/LaunchScreen.js', import.meta.url), { name: 'LaunchScreen', deps: {
    'react-native': { ...nativeViews, Image: 'Image', Animated: { View: 'Animated.View' }, useWindowDimensions: () => ({ width: 320, height: 568 }) },
    'lottie-react-native': 'Lottie', '../lib/theme-context': { useTheme: () => ({ scheme, colors: { background: '#F5F2EC' } }) },
    '../lib/settings-context': { useSettings: () => ({ settings: { highContrast } }) }, '../lib/theme': { fonts: {} },
    '../lib/use-launch-sequence': { useLaunchSequence: () => ({ reducedMotion, exit: 1, finish, animationFailed }) },
    '../lib/use-launch-audio': { useLaunchAudio: audio },
    './logo': { FleetOpsMark: 'FleetOpsMark', FleetOpsWordmark: 'FleetOpsWordmark' }, ...assets,
  } });
  const art = () => h.find(n => n.component === 'Lottie');
  expect(art().props.loop).toBe(false); expect(art().props.autoPlay).toBe(false);
  expect(art().props.source).toBe(assets['../assets/brand/route-reveal-light.json']);
  expect(art().props.style.width).toBeCloseTo(568 * 312 / 648);
  expect(art().props.style.height).toBeCloseTo(568);
  expect(audio).toHaveBeenLastCalledWith(false);
  const play = vi.fn();
  art().props.ref.current = { play };
  art().props.onAnimationLoaded(); h.render();
  expect(play).toHaveBeenCalledOnce();
  expect(audio).toHaveBeenLastCalledWith(true);
  art().props.onAnimationLoaded(); h.render();
  expect(play).toHaveBeenCalledOnce();
  expect(h.find(n => n.props.accessibilityLabel === 'FleetOps')).toBeDefined();
  expect(h.text()).not.toContain('Further together');
  expect(h.text()).not.toContain('Moving operations');
  art().props.onAnimationFinish(true); expect(finish).not.toHaveBeenCalled();
  art().props.onAnimationFinish(false); expect(finish).toHaveBeenCalledOnce();
  art().props.onAnimationFailure('renderer unavailable'); expect(animationFailed).toHaveBeenCalledOnce();
  scheme = 'dark'; highContrast = true; h.render();
  // A theme change must not restart the local composition halfway through startup.
  expect(art().props.source).toBe(assets['../assets/brand/route-reveal-light.json']);
  reducedMotion = true; h.render(); expect(art()).toBeUndefined();
  expect(h.find(n => n.component === 'Image').props.source).toBe('final-light');
  expect(audio).toHaveBeenLastCalledWith(false);
  reducedMotion = null; h.render();
  // Do not flash the completed wordmark before the first animated frame.
  expect(h.find(n => n.component === 'Image')).toBeUndefined();
});

it('notifies launch subscribers once, tolerates reentry, and handles unsubscribe and late listeners', async () => {
  vi.resetModules();
  const { completeLaunch, onLaunchComplete } = await import('./launch');
  const cancelled = vi.fn(), second = vi.fn(), late = vi.fn();
  const first = vi.fn(() => completeLaunch());
  const unsubscribe = onLaunchComplete(cancelled); unsubscribe();
  onLaunchComplete(first); onLaunchComplete(second);
  completeLaunch(); completeLaunch();
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(cancelled).not.toHaveBeenCalled();
  onLaunchComplete(late); expect(late).toHaveBeenCalledOnce();
});

it.each(['timeout', 'late load'])('uses static artwork on %s without truncating the final hold', async reason => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const failed = vi.fn(), play = vi.fn(), audio = vi.fn();
  const assets = Object.fromEntries(['light', 'dark', 'high-contrast-light', 'high-contrast-dark'].flatMap(v => [
    [`../assets/brand/route-reveal-${v}.json`, { w: 312, h: 630 }], [`../assets/brand/launch-${v}.png`, v],
  ]));
  const h = await nativeRender(new URL('../components/LaunchScreen.js', import.meta.url), { name: 'LaunchScreen', deps: {
    'react-native': { ...nativeViews, Image: 'Image', Animated: { View: 'Animated.View' }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'lottie-react-native': 'Lottie', '../lib/theme-context': { useTheme: () => ({ scheme: 'dark' }) },
    '../lib/settings-context': { useSettings: () => ({ settings: {} }) },
    '../lib/use-launch-sequence': { useLaunchSequence: () => ({ reducedMotion: false, exit: 1, finish: vi.fn(), animationFailed: failed }) },
    '../lib/use-launch-audio': { useLaunchAudio: audio }, ...assets,
  } });
  try {
    await h.flushEffects();
    const art = h.find(n => n.component === 'Lottie');
    art.props.ref.current = { play };
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(150);
    else {
      // Native load can arrive before an overdue JS timer gets a chance to run.
      vi.setSystemTime(151);
      art.props.onAnimationLoaded();
    }
    expect(failed).toHaveBeenCalledOnce();
    art.props.onAnimationLoaded(); h.render();
    expect(play).not.toHaveBeenCalled();
    expect(audio).toHaveBeenLastCalledWith(false);
    h.unmount(); art.props.onAnimationLoaded();
    expect(play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { h.unmount(); vi.useRealTimers(); }
});
