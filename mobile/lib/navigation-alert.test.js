import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { beginNavigationHandoff } from './navigation-handoff';
import { navigationTarget } from './navigation-route';
import { launchExternalNavigation } from './external-navigation';
import { createTripBubbleHandoff } from './trip-bubble-handoff';

const { code } = await transform(readFileSync('mobile/components/AppAlert.js', 'utf8'), { loader: 'jsx', format: 'cjs' });

function host(options = {}, delayedDismiss = false) {
  const onDismiss = vi.fn(), selected = vi.fn(), setVisible = vi.fn();
  const config = { title: 'Background tracking unavailable', message: 'Tracking warning',
    buttons: [{ text: 'Stay Here' }, { text: 'Continue Without Tracking', style: 'cancel', onPress: selected }], options: { onDismiss, ...options } };
  let cursor = 0;
  const hooks = [], dismissals = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useRef: current => { const index = cursor++; return hooks[index] ??= { current }; },
    useEffect: effect => { const index = cursor++; if (!hooks[index]) { hooks[index] = true; effect(); } },
    useState: initial => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], value => { hooks[index] = value; if (index === 0) setVisible(value); }];
    } };
  const animated = { Value: class { setValue() {} }, View: 'AnimatedView', timing: () => ({}), spring: () => ({}), parallel: () => ({ start: done => { if (done && delayedDismiss) dismissals.push(done); else done?.(); } }) };
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
  const render = () => {
    cursor = 0;
    const tree = loaded.exports.AppAlertHost(), nodes = [];
    const walk = node => { if (!node || typeof node !== 'object') return; nodes.push(node); node.props?.children?.forEach(walk); };
    walk(tree); return { tree, nodes };
  };
  render();
  loaded.exports.AppAlert.alert(config.title, config.message, config.buttons, config.options);
  return { ...render(), render, AppAlert: loaded.exports.AppAlert, onDismiss, selected, setVisible, config: () => hooks[1], completeDismiss: () => dismissals.shift()?.() };
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
  it('releases a real same-screen navigation warning when another alert replaces it', async () => {
    const h = host(), navigationBusyRef = { current: false }, openURL = vi.fn();
    const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
    const start = source.indexOf('  const openExternalNavigation ='), end = source.indexOf('  const handleMapReady', start);
    const prepare = vi.fn().mockResolvedValue({ ok: false, reason: 'permission-denied' });
    const action = runInNewContext(`${source.slice(start, end)}; openExternalNavigation`, {
      navigationBusyRef, navigationOperationRef: { current: null }, trackingTransitionRef: { current: Promise.resolve() }, setNavigationBusy: () => {},
      tripBubbleRef: { current: createTripBubbleHandoff({ show: async () => {}, hide: async () => {} }) },
      activeTripRef: { current: { trip_id: 7, trip_status: 'En Route', destination_latitude: 14.7, destination_longitude: 121.1 } },
      appState: { current: 'active' }, user: { employeeId: 23 }, captureCargoSession: () => ({}), isCurrentCargoSession: () => true,
      navigationTarget, beginNavigationHandoff, launchExternalNavigation, prepareBackgroundTracking: prepare, stopBackgroundTracking: async () => {},
      isGpsTrackedTrip: () => true, Linking: { openURL }, AppAlert: h.AppAlert,
    });
    await action(); expect(navigationBusyRef.current).toBe(true);
    const warningDismiss = vi.fn(h.config().options.onDismiss); h.config().options.onDismiss = warningDismiss;
    const errorDismiss = vi.fn();
    h.AppAlert.alert('Trip action failed', 'Try again.', undefined, { onDismiss: errorDismiss });
    expect(warningDismiss).toHaveBeenCalledOnce(); expect(navigationBusyRef.current).toBe(false);
    h.render().tree.props.onRequestClose(); h.render().tree.props.onRequestClose();
    expect(warningDismiss).toHaveBeenCalledOnce(); expect(errorDismiss).toHaveBeenCalledOnce(); expect(openURL).not.toHaveBeenCalled();
    await action(); expect(prepare).toHaveBeenCalledTimes(2); expect(navigationBusyRef.current).toBe(true);
  });
  it('does not run a dismissed warning action or hide its replacement when its old animation finishes', () => {
    const h = host({}, true), replacementDismiss = vi.fn();
    h.nodes.find(node => node.props?.accessibilityLabel === 'Continue Without Tracking').props.onPress();
    h.AppAlert.alert('New alert', 'Replacement', undefined, { onDismiss: replacementDismiss });
    expect(h.onDismiss).toHaveBeenCalledOnce();
    h.completeDismiss();
    expect(h.selected).not.toHaveBeenCalled(); expect(h.onDismiss).toHaveBeenCalledOnce();
    expect(h.render().tree.props.visible).toBe(true);
    h.render().tree.props.onRequestClose(); h.completeDismiss();
    expect(replacementDismiss).toHaveBeenCalledOnce();
  });
});
