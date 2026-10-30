import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';

async function bar({ route = 'index', width = 320, fontScale = 2 } = {}) {
  const navigate = vi.fn(), emit = vi.fn(() => ({ defaultPrevented: false })), intro = vi.fn(), push = vi.fn();
  const routes = ['index', 'map', 'trips', 'profile'].map(name => ({ key: name, name }));
  const h = await nativeRender(new URL('../components/CurvedPillTabBar.js', import.meta.url), { name: 'CurvedPillTabBar', props: {
    state: { routes, index: routes.findIndex(r => r.name === route) }, navigation: { navigate, emit },
  }, deps: {
    'react-native': { ...nativeViews, Image: 'Image', useWindowDimensions: () => ({ width, fontScale }) },
    'expo-router': { useRouter: () => ({ push }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '../lib/theme-context': { useTheme: () => ({ scheme: 'dark', colors: { surface: '#112211', primary: '#bbffbb', onPrimary: '#001100', onSurfaceVariant: '#aabbaa', outlineVariant: '#335533', shadow: '#000' }, type: { caption: { fontSize: 14 } } }) },
    '../lib/theme': { fonts: {} },
    './coachmarks': { useCoachMarkActions: () => ({ triggerMapIntroFromTab: intro }), CoachMarkTarget: 'Target' },
    '../lib/map-intro': { isMapTabIntent: name => name === 'map' },
    '../assets/images/clay_wave_light.png': 1, '../assets/images/clay_wave_dark.png': 1,
  } });
  return { h, navigate, emit, intro, push };
}

it('keeps four destinations and the existing Map intro and tab event', async () => {
  const { h, navigate, emit, intro } = await bar();
  expect(h.nodes().filter(n => n.props.accessibilityRole === 'tab')).toHaveLength(4);
  h.find(n => n.props.accessibilityLabel === 'Map tab').props.onPress();
  expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'map', canPreventDefault: true });
  expect(intro).toHaveBeenCalledWith({ source: 'map-tab' });
  expect(navigate).toHaveBeenCalledWith('map');
});

it('keeps Map clearance compatible with the restored original navigation bar', async () => {
  const { h } = await bar();
  expect(h.exports.getTabBarHeight({ fontSize: 14, fontScale: 2 })).toBe(64);
  expect(h.exports.getDynamicBottomOffset(48)).toBe(52);
});

it('keeps the scan shortcut off Map and opens the existing fuel scanner', async () => {
  const map = await bar({ route: 'map' });
  expect(map.h.find(n => n.props.accessibilityLabel === 'Scan fuel gauge or receipt')).toBeUndefined();
  const home = await bar();
  home.h.find(n => n.props.accessibilityLabel === 'Scan fuel gauge or receipt').props.onPress();
  expect(home.push).toHaveBeenCalledWith({ pathname: '/fuel-report', params: { scan: '1' } });
});
