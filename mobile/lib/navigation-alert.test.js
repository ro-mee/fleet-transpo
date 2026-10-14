import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';

const { code } = await transform(readFileSync('mobile/components/AppAlert.js', 'utf8'), { loader: 'jsx', format: 'cjs' });

function host(options = {}) {
  const onDismiss = vi.fn(), selected = vi.fn(), setVisible = vi.fn();
  const config = { title: 'Background tracking unavailable', message: 'Tracking warning',
    buttons: [{ text: 'Stay Here' }, { text: 'Continue Without Tracking', style: 'cancel', onPress: selected }], options: { onDismiss, ...options } };
  let state = 0;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useRef: current => ({ current }), useEffect: () => {}, useState: initial => {
      state++;
      return state === 1 ? [true, setVisible] : state === 2 ? [config, () => {}] : [typeof initial === 'function' ? initial() : initial, () => {}];
    } };
  const animated = { Value: class { setValue() {} }, View: 'AnimatedView', timing: () => ({}), spring: () => ({}), parallel: () => ({ start: done => done?.() }) };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal', Animated: animated,
    Platform: { select: () => ({}) }, StyleSheet: { create: value => value, absoluteFillObject: {} } };
  const loaded = { exports: {} };
  runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => {
    if (name === 'react') return { ...react, default: react };
    if (name === 'react-native') return native;
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name === '../lib/theme-context') return { useTheme: () => ({ colors: { info: '#123456', warning: '#123456', primary: '#111111', onPrimary: '#ffffff' } }) };
    if (name === '../lib/theme') return { fonts: {} };
    throw new Error(name);
  } });
  const tree = loaded.exports.AppAlertHost();
  const nodes = [];
  const walk = node => { if (!node || typeof node !== 'object') return; nodes.push(node); node.props?.children?.forEach(walk); };
  walk(tree);
  return { tree, nodes, onDismiss, selected, setVisible };
}

describe('shared warning alert opt-ins', () => {
  it('notifies the caller after hardware Back dismisses the alert', () => {
    const h = host(); h.tree.props.onRequestClose();
    expect(h.setVisible).toHaveBeenCalledWith(false); expect(h.onDismiss).toHaveBeenCalledOnce(); expect(h.selected).not.toHaveBeenCalled();
  });
  it('notifies dismissal after the selected action takes ownership', () => {
    const h = host(); h.nodes.find(node => node.props?.accessibilityLabel === 'Continue Without Tracking').props.onPress();
    expect(h.selected).toHaveBeenCalledOnce(); expect(h.onDismiss).toHaveBeenCalledOnce();
    expect(h.selected.mock.invocationCallOrder[0]).toBeLessThan(h.onDismiss.mock.invocationCallOrder[0]);
  });
  it('gives opt-in long action labels the full width with room to wrap', () => {
    const h = host({ buttonLayout: 'stacked' });
    const button = h.nodes.find(node => node.props?.accessibilityLabel === 'Continue Without Tracking');
    expect(button.props.style({ pressed: false }).at(-1)).toMatchObject({ width: '100%', flex: undefined });
    expect(button.props.children[0].props.numberOfLines).toBeUndefined();
    expect(h.nodes.some(node => node.props?.style?.some?.(style => style?.alignItems === 'stretch'))).toBe(true);
  });
  it('preserves the existing default row layout', () => {
    const h = host(); const button = h.nodes.find(node => node.props?.accessibilityLabel === 'Continue Without Tracking');
    expect(button.props.style({ pressed: false }).at(-1)).toMatchObject({ flex: 1, width: undefined });
    expect(button.props.children[0].props.numberOfLines).toBe(1);
  });
});
