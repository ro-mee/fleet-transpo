import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeTheme, nativeViews } from './test-helpers/native-render';

const brand = { FleetOpsMark: 'FleetOpsMark', FleetOpsWordmark: 'FleetOpsWordmark' };
const shared = {
  'react-native': nativeViews,
  '../../lib/theme-context': nativeTheme,
  '../../lib/theme': { fonts: {} },
  '../../lib/scaling': { moderateScale: value => value },
  '../logo': brand,
};

describe('mobile FleetOps brand integration', () => {
  it('uses the shared identity once in the login brand block', async () => {
    const h = await nativeRender(new URL('../components/auth/AuthHeader.jsx', import.meta.url), {
      name: 'AuthHeader', props: { icon: 'car-sport', title: 'FleetOps', tagline: 'Your driver companion' },
      deps: { ...shared, '../clay': { ClayTile: 'ClayTile' } },
    });
    expect(h.find(n => n.component === 'FleetOpsMark')).toBeDefined();
    expect(h.find(n => n.component === 'FleetOpsWordmark')).toBeDefined();
    expect(h.nodes().filter(n => n.props.accessibilityLabel === 'FleetOps')).toHaveLength(1);
    expect(h.find(n => n.component === 'ClayTile')).toBeUndefined();
    expect(h.text()).toContain('Your driver companion');
  });

  it.each([['Reset password', 'lock-closed'], ['Forgot password', 'key']])('preserves the security context for %s', async (title, icon) => {
    const h = await nativeRender(new URL('../components/auth/AuthHeader.jsx', import.meta.url), {
      name: 'AuthHeader', props: { icon, title, tagline: 'Keep your account secure' },
      deps: { ...shared, '../clay': { ClayTile: 'ClayTile' } },
    });
    expect(h.find(n => n.component === 'ClayTile').props.icon).toBe(icon);
    expect(h.find(n => n.component === 'FleetOpsMark')).toBeUndefined();
    expect(h.text()).toContain(title);
  });

  it.each([false, true])('keeps onboarding readable on its dark backdrop with high contrast %s', async highContrast => {
    const h = await nativeRender(new URL('../components/onboarding/OnboardingHeader.jsx', import.meta.url), {
      name: 'OnboardingHeader', props: { step: '2/2', compact: true },
      deps: { ...shared, '@expo/vector-icons': { Ionicons: 'Icon' }, './onboardingTheme': { onboardingTheme: { colors: {} } },
        '../../lib/settings-context': { useSettings: () => ({ settings: { highContrast } }) } },
    });
    const variant = highContrast ? 'highContrastDark' : 'dark';
    expect(h.find(n => n.component === 'FleetOpsMark')?.props.variant).toBe(variant);
    expect(h.find(n => n.component === 'FleetOpsWordmark')?.props.variant).toBe(variant);
    expect(h.text()).toContain('2/2');
    expect(h.find(n => n.component === 'Icon')).toBeUndefined();
  });

  it('shows a restrained Home signature while keeping the profile and notification actions', async () => {
    const captured = [];
    const primitive = tag => function Native({ children, accessibilityLabel, onPress }) {
      if (onPress) captured.push({ accessibilityLabel, onPress });
      return React.createElement(tag, { 'aria-label': accessibilityLabel }, children);
    };
    const { code } = await transform(readFileSync(new URL('../components/home/DriverHomeHeader.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
    const scope = { exports: {} };
    const deps = {
      react: React,
      'react-native': { ...nativeViews, View: primitive('div'), Text: primitive('span'), Pressable: primitive('button'), Image: () => null,
        useWindowDimensions: () => ({ width: 320, fontScale: 2 }) },
      'expo-linear-gradient': { LinearGradient: primitive('div') },
      '@expo/vector-icons': { Ionicons: () => null },
      '../../lib/theme-context': nativeTheme,
      '../../lib/settings-context': { useSettings: () => ({ settings: { highContrast: true, textSize: 'large' } }) },
      '../WeatherChip': { default: () => React.createElement('span', null, 'Weather'), __esModule: true },
      './materials': { homeMaterials: () => ({}) },
      '../logo': { FleetOpsMark: () => React.createElement('i', { 'data-brand': 'mark' }), FleetOpsWordmark: () => React.createElement('span', null, 'FleetOps') },
    };
    runInNewContext(code, { module: scope, exports: scope.exports, React, require: name => {
      if (!(name in deps)) throw new Error(`Unexpected header dependency: ${name}`);
      return deps[name];
    } });
    const onProfile = vi.fn(), onNotifications = vi.fn();
    const html = renderToStaticMarkup(React.createElement(scope.exports.default, {
      driverName: 'Jane Santos', driverType: 'Cargo', initial: 'J', unreadCount: 3, topInset: 0, onProfile, onNotifications,
    }));
    expect(html).toContain('data-brand="mark"');
    expect(html).toContain('FleetOps');
    expect(html).toContain('Jane Santos');
    expect(html).toContain('Weather');
    captured.find(n => n.accessibilityLabel === 'Open profile').onPress();
    captured.find(n => n.accessibilityLabel === 'Notifications, 3 unread').onPress();
    expect(onProfile).toHaveBeenCalledOnce();
    expect(onNotifications).toHaveBeenCalledOnce();
  });
});
