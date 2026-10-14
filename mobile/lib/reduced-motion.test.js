import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

const { code } = await transform(readFileSync(new URL('./use-reduced-motion.js', import.meta.url), 'utf8'), { format: 'cjs' });
function harness(initial) {
  let effect, listener, value;
  const remove = vi.fn();
  const updates = [];
  const deps = {
    react: { useState: seed => { value = seed; return [seed, next => { value = next; updates.push(next); }]; }, useEffect: fn => { effect = fn; } },
    'react-native': { AccessibilityInfo: { isReduceMotionEnabled: () => initial, addEventListener: (event, fn) => { expect(event).toBe('reduceMotionChanged'); listener = fn; return { remove }; } } },
  };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, require: name => deps[name] });
  scope.exports.useReducedMotion();
  const cleanup = effect();
  return { get value() { return value; }, change: next => listener(next), cleanup, remove, updates };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
describe('shared system reduced-motion preference', () => {
  it('starts conservatively and adopts the native initial preference', async () => {
    const h = harness(Promise.resolve(false)); expect(h.value).toBe(true);
    await flush(); expect(h.value).toBe(false);
    h.change(true); expect(h.value).toBe(true);
  });
  it('does not let a late initial query overwrite a newer system event', async () => {
    let resolve; const h = harness(new Promise(r => { resolve = r; }));
    h.change(true); resolve(false); await flush(); expect(h.value).toBe(true);
  });
  it('removes its listener and fences late replies and events after unmount', async () => {
    let resolve; const h = harness(new Promise(r => { resolve = r; }));
    h.cleanup(); resolve(false); h.change(false); await flush();
    expect(h.remove).toHaveBeenCalledOnce(); expect(h.updates).toEqual([]);
  });
  it('keeps motion reduced when the native preference query fails', async () => {
    const h = harness(Promise.reject(Error('unavailable'))); await flush(); expect(h.value).toBe(true);
  });
});
