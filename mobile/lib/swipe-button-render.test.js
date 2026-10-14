import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { code } = await transform(readFileSync(new URL('../components/SwipeButton.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
function harness(onSwipeSuccess, reduced = false) {
  const state = [], refs = [], values = [], effects = [];
  let cursor = 0, refCursor = 0, handlers, tree;
  const animations = [];
  class Value {
    constructor(value) { this.value = value; values.push(this); }
    setValue(value) { this.value = value; }
    interpolate() { return this; }
  }
  const animation = (value, options) => { animations.push(options); return { start: fn => { value.setValue(options.toValue); fn?.(); } }; };
  const react = { ...React, useState: initial => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; }, useRef: initial => { const i = refCursor++; return refs[i] ||= { current: initial }; }, useEffect: fn => { effects.push(fn); } };
  const deps = {
    react,
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner', StyleSheet: { create: x => x, absoluteFill: {} }, Animated: { Value, View: 'AnimatedView', add: () => 0, spring: animation, timing: animation, parallel: steps => ({ start: fn => { steps.forEach(step => step.start()); fn?.(); } }) }, PanResponder: { create: h => { handlers = h; return { panHandlers: {} }; } } },
    '@expo/vector-icons': { Ionicons: 'Icon' }, '../lib/theme-context': { useTheme: () => ({ colors: { primary: '#285448', onPrimary: '#fff', onSurfaceVariant: '#53615A', surfaceContainerHighest: '#E3DED5' } }) }, '../lib/theme': { fonts: {} }, '../lib/use-reduced-motion': { useReducedMotion: () => reduced },
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: react, module: scope, exports: scope.exports, setTimeout, clearTimeout, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  const render = () => { cursor = refCursor = 0; effects.length = 0; tree = scope.exports.default({ title: 'Cargo loaded', onSwipeSuccess }); effects.forEach(fn => fn()); return tree; };
  render();
  return { render, values, animations, get handlers() { return handlers; }, activate: () => tree.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
describe('real shared swipe confirmation', () => {
  it('uses static confirmation without spring or timing animation in reduced motion', async () => {
    vi.useFakeTimers(); const h = harness(() => Promise.resolve(true), true);
    h.handlers.onPanResponderGrant(); h.activate(); await flush();
    expect(h.values[1].value).toBe(1); expect(h.animations).toEqual([]);
    vi.advanceTimersByTime(900); expect(h.values[1].value).toBe(0);
  });
  it('keeps success hidden until a confirmed response and locks duplicate activation', async () => {
    vi.useFakeTimers(); let resolve; const submit = vi.fn(() => new Promise(r => { resolve = r; }));
    const h = harness(submit); h.activate(); h.activate();
    expect(submit).toHaveBeenCalledOnce(); expect(h.values[1].value).toBe(0);
    expect(h.render().props.accessibilityState.busy).toBe(true);
    resolve(true); await flush(); expect(h.values[1].value).toBe(1);
  });
  it('keeps the pending label readable on the neutral track', () => {
    vi.useFakeTimers(); const h = harness(() => new Promise(() => {})); h.activate();
    const find = node => {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'Text' && node.props.children === 'Submitting…') return node;
      return React.Children.toArray(node.props?.children).map(find).find(Boolean);
    };
    const label = find(h.render());
    expect(label.props.style.at(-1).color).toBe('#53615A');
  });
  it.each([false, undefined, { queued: true }])('does not claim success for unconfirmed %s', async result => {
    vi.useFakeTimers(); const h = harness(() => Promise.resolve(result)); h.activate(); await flush();
    expect(h.values[1].value).toBe(0); expect(h.render().props.accessibilityState.busy).toBe(false);
  });
  it('resets after a rejected action and permits retry', async () => {
    vi.useFakeTimers(); const submit = vi.fn().mockRejectedValueOnce(Error('refused')).mockResolvedValueOnce(true);
    const h = harness(submit); h.activate(); await flush(); expect(h.values[1].value).toBe(0);
    h.activate(); await flush(); expect(submit).toHaveBeenCalledTimes(2); expect(h.values[1].value).toBe(1);
  });
  it('uses the same confirmed contract for the gesture path', async () => {
    vi.useFakeTimers(); let resolve; const h = harness(() => new Promise(r => { resolve = r; }));
    h.handlers.onPanResponderRelease(null, { dx: 200, vx: 1 }); expect(h.values[1].value).toBe(0);
    resolve(true); await flush(); expect(h.values[1].value).toBe(1);
  });
});
