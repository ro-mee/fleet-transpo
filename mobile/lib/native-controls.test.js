import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';

async function theme(width = 390) {
  const scaling = { exports: {} };
  const scaleSource = await transform(readFileSync(new URL('./scaling.js', import.meta.url), 'utf8'), { format: 'cjs' });
  runInNewContext(scaleSource.code, { module: scaling, exports: scaling.exports, require: () => ({ Dimensions: { get: () => ({ width, height: 844 }) } }) });
  const loaded = { exports: {} };
  const source = await transform(readFileSync(new URL('./theme.js', import.meta.url), 'utf8'), { format: 'cjs' });
  runInNewContext(source.code, { module: loaded, exports: loaded.exports, require: () => scaling.exports });
  return loaded.exports;
}
const flatten = styles => Object.assign({}, ...styles.flat(Infinity).filter(Boolean));
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};

describe('shared native control accessibility', () => {
  it('keeps opaque status text readable in all four palettes', async () => {
    const t = await theme();
    for (const [name, palette] of Object.entries(t.palettes)) {
      for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
        const { bg, fg } = t.statusColorForTone(palette, tone);
        const values = [luminance(bg), luminance(fg)].sort((a, b) => a - b);
        expect((values[1] + 0.05) / (values[0] + 0.05), `${name} ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each([320, 360, 390])('keeps native touch targets at least 48dp at width %i', async width => {
    expect((await theme(width)).TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });
  it('names the input and password visibility action, preserves caller overrides, and invokes its callback', async () => {
    const press = vi.fn();
    const harness = await nativeRender(new URL('../components/clay/ClayInput.jsx', import.meta.url), { name: 'ClayInput', props: { label: 'Password', secureTextEntry: true, rightIcon: 'eye-outline', onRightIconPress: press }, deps: {
      'react-native': nativeViews, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': { useTheme: () => ({ ...nativeTheme.useTheme(), type: { bodyMd: { fontSize: 19, lineHeight: 26 } } }) },
      '../../lib/theme': { fonts: { body: 'RegisteredBody', bodySemiBold: 'RegisteredSemiBold' } }, './molded-materials': { moldedMaterials: () => ({ supported: true, clayInput: {} }) },
    } });
    expect(harness.find(n => n.component === 'TextInput').props.accessibilityLabel).toBe('Password');
    expect(flatten(harness.find(n => n.component === 'TextInput').props.style)).toMatchObject({ fontSize: 19, fontFamily: 'RegisteredBody' });
    let action = harness.find(n => n.component === 'Pressable');
    expect(action.props.accessibilityLabel).toBe('Show password');
    expect(flatten([action.props.style]).minWidth).toBeGreaterThanOrEqual(48);
    expect(flatten([action.props.style]).minHeight).toBeGreaterThanOrEqual(48);
    action.props.onPress(); expect(press).toHaveBeenCalledOnce();
    harness.render({ secureTextEntry: false });
    action = harness.find(n => n.component === 'Pressable');
    expect(action.props.accessibilityLabel).toBe('Hide password');
    harness.render({ accessibilityLabel: 'New password', inputStyle: { fontSize: 27 }, rightIconAccessibilityLabel: 'Custom action' });
    expect(harness.find(n => n.component === 'TextInput').props.accessibilityLabel).toBe('New password');
    expect(flatten(harness.find(n => n.component === 'TextInput').props.style).fontSize).toBe(27);
    expect(harness.find(n => n.component === 'Pressable').props.accessibilityLabel).toBe('Custom action');
  });
});
