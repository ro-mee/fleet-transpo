import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { expect, it } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';
import { homeTripAction, homeTripReadiness } from './home-trips';
import * as load from './load-presentation';

const loaded = { exports: {} };
const source = await transform(readFileSync(new URL('./theme.js', import.meta.url), 'utf8'), { format: 'cjs' });
runInNewContext(source.code, { module: loaded, exports: loaded.exports, require: () => ({ moderateScale: n => n, scale: n => n, verticalScale: n => n }) });
const theme = loaded.exports;
const flatten = list => Object.assign({}, ...list.flat(Infinity).filter(Boolean));
const luminance = hex => hex.slice(1).match(/../g).map(n => parseInt(n, 16) / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);

it('keeps actual upcoming-trip labels readable in every palette', async () => {
  for (const [name, colors] of Object.entries(theme.palettes)) {
    const h = await nativeRender(new URL('../components/home/DriverHomeCards.jsx', import.meta.url), { name: 'DriverTripCard', props: { variant: 'next', nowMs: 0 }, deps: {
      'react-native': { ...nativeViews, useWindowDimensions: () => ({ width: 320, fontScale: 1 }) },
      'expo-linear-gradient': { LinearGradient: 'Gradient' },
      '@expo/vector-icons': { Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' },
      '../../lib/theme-context': { useTheme: () => ({ colors, type: {}, scheme: name.toLowerCase().includes('dark') ? 'dark' : 'light' }) },
      '../../lib/settings-context': { useSettings: () => ({ settings: {} }) },
      '../../lib/use-reduced-motion': { useReducedMotion: () => true },
      '../../lib/home-trips': { homeTripAction, homeTripReadiness },
      '../../lib/theme': theme, '../../lib/scaling': { moderateScale: n => n },
      '../../lib/quick-action-press.js': { QUICK_ACTION_PRESS: {} },
      '../../lib/load-presentation.js': load, './materials': { homeMaterials: () => ({}) }, '../clay': { ClayCard: 'Card' },
      '../TripMapPreview': {}, '../RadarPulse': {}, '../OffDutyIllustration': {}, '../coachmarks': {},
      '../../assets/images/map.png': 1,
      '../../assets/images/hotel.png': 2,
      '../../assets/images/cargo-depot.png': 3,
    } });
    const label = h.find(n => n.component === 'Text' && n.children.includes('NEXT TRIP'));
    const parent = h.find(n => n.children.includes(label));
    const fg = flatten(label.props.style).color, bg = flatten(parent.props.style).backgroundColor;
    const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
    expect((values[1] + 0.05) / (values[0] + 0.05), name).toBeGreaterThanOrEqual(4.5);
  }
});
