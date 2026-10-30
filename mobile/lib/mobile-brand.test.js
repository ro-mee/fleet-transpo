import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';

const variants = ['light', 'dark', 'highContrastLight', 'highContrastDark'];
const filenames = ['light', 'dark', 'high-contrast-light', 'high-contrast-dark'];
const assets = Object.fromEntries(filenames.flatMap(name => [
  [`../assets/brand/mark-${name}.png`, `mark-${name}`],
]));
assets['../assets/brand/wordmark-light.png'] = 'wordmark-light';
assets['../assets/brand/wordmark-dark.png'] = 'wordmark-dark';
const theme = { scheme: 'light', colors: { background: '#F5F2EC', onSurfaceVariant: '#456054' }, type: { caption: {} } };
const settings = { highContrast: false };
const deps = {
  'react-native': { ...nativeViews, Image: 'Image' },
  '../lib/theme-context': { useTheme: () => theme },
  '../lib/settings-context': { useSettings: () => ({ settings }) },
  '../lib/theme': { fonts: { displaySemiBold: 'JakartaSemiBold', bodyMedium: 'JakartaMedium' } },
  ...assets,
};

afterEach(() => { theme.scheme = 'light'; settings.highContrast = false; });

it('uses one custom mark in light, dark and both monochrome variants', async () => {
  const h = await nativeRender(new URL('../components/logo.js', import.meta.url), { name: 'FleetOpsMark', deps });
  for (let i = 0; i < variants.length; i++) {
    h.render({ variant: variants[i], size: 64 });
    const image = h.find(n => n.component === 'Image');
    expect(image.props.source).toBe(`mark-${filenames[i]}`);
    expect(image.props.style).toContainEqual(expect.objectContaining({ width: 64, height: 64 }));
  }
  theme.scheme = 'dark'; settings.highContrast = true; h.render({ variant: undefined });
  expect(h.find(n => n.component === 'Image').props.source).toBe('mark-high-contrast-dark');
});

it('keeps the readable FleetOps name and a single accessible brand label', async () => {
  const h = await nativeRender(new URL('../components/logo.js', import.meta.url), { name: 'Logo', deps });
  expect(h.find(n => n.props.accessibilityLabel === 'FleetOps')).toBeDefined();
  expect(h.find(n => n.component === h.exports.FleetOpsMark)).toBeDefined();
  expect(h.find(n => n.component === h.exports.FleetOpsWordmark)).toBeDefined();
  h.render({ showText: false });
  expect(h.find(n => n.component === h.exports.FleetOpsWordmark)).toBeUndefined();
  const word = await nativeRender(new URL('../components/logo.js', import.meta.url), { name: 'FleetOpsWordmark', deps });
  expect(word.find(n => n.component === 'Image').props.source).toBe('wordmark-light');
  word.render({ variant: 'dark' });
  expect(word.find(n => n.component === 'Image').props.source).toBe('wordmark-dark');
  word.render({ variant: 'highContrastLight' });
  expect(word.text()).toContain('FleetOps');
  expect(word.find(n => n.component === 'Text').props.allowFontScaling).toBe(false);
});

it('points installed app icons and the native light/dark splash to the new identity', () => {
  const { expo } = JSON.parse(readFileSync('mobile/app.json', 'utf8'));
  const splash = expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')?.[1];
  expect(splash).toMatchObject({ backgroundColor: '#F5F2EC', image: './assets/brand/splash-mark-light.png', dark: { backgroundColor: '#0D1713', image: './assets/brand/splash-mark-dark.png' } });
  expect(expo.android.adaptiveIcon.monochromeImage).toBe('./assets/android-icon-monochrome.png');
  expect(expo.android.adaptiveIcon.foregroundImage).toBe('./assets/android-icon-foreground.png');
});
