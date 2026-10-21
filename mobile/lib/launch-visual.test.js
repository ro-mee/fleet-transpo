import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';

it('renders the new route composition once and connects cancellation, completion and failure correctly', async () => {
  const finish = vi.fn(), animationFailed = vi.fn();
  let reducedMotion = false, scheme = 'light', highContrast = false;
  const variants = ['light', 'dark', 'high-contrast-light', 'high-contrast-dark'];
  const assets = Object.fromEntries(variants.map(v => [`../assets/brand/route-reveal-${v}.json`, JSON.parse(readFileSync(`mobile/assets/brand/route-reveal-${v}.json`, 'utf8'))]));
  const h = await nativeRender(new URL('../components/LaunchScreen.js', import.meta.url), { name: 'LaunchScreen', deps: {
    'react-native': { ...nativeViews, Animated: { View: 'Animated.View' }, useWindowDimensions: () => ({ width: 320, height: 568 }) },
    'lottie-react-native': 'Lottie', '../lib/theme-context': { useTheme: () => ({ scheme, colors: { background: '#F5F2EC' } }) },
    '../lib/settings-context': { useSettings: () => ({ settings: { highContrast } }) }, '../lib/theme': { fonts: {} },
    '../lib/use-launch-sequence': { useLaunchSequence: () => ({ reducedMotion, reveal: 1, tagline: 1, exit: 1, finish, animationFailed }) },
    './logo': { FleetOpsMark: 'FleetOpsMark', FleetOpsWordmark: 'FleetOpsWordmark' }, ...assets,
  } });
  const art = () => h.find(n => n.component === 'Lottie');
  expect(art().props.loop).toBe(false); expect(art().props.autoPlay).toBe(true);
  expect(art().props.source).toBe(assets['../assets/brand/route-reveal-light.json']);
  art().props.onAnimationFinish(true); expect(finish).not.toHaveBeenCalled();
  art().props.onAnimationFinish(false); expect(finish).toHaveBeenCalledOnce();
  art().props.onAnimationFailure('renderer unavailable'); expect(animationFailed).toHaveBeenCalledOnce();
  scheme = 'dark'; highContrast = true; h.render();
  expect(art().props.source).toBe(assets['../assets/brand/route-reveal-high-contrast-dark.json']);
  reducedMotion = true; h.render(); expect(art()).toBeUndefined();
  expect(h.find(n => n.component === 'FleetOpsMark').props.variant).toBe('highContrastDark');
  expect(h.text()).toContain('Further together.');
  reducedMotion = null; h.render(); expect(h.find(n => n.component === 'FleetOpsMark')).toBeDefined();
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
