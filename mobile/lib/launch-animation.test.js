import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const url = new URL('./use-launch-sequence.js', import.meta.url);
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

// Execute the complete hook; only native animation and system preferences are replaced.
async function mount(query = Promise.resolve(false)) {
  expect(existsSync(url), 'the bounded launch hook must exist').toBe(true);
  const { code } = await transform(readFileSync(url, 'utf8'), { format: 'cjs' });
  const cells = [], effects = [], cleanups = new Map(), animations = [];
  let cursor = 0, result, listener, callback = vi.fn();
  const remove = vi.fn();
  const different = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    useState(seed) { const i = cursor++; if (!(i in cells)) cells[i] = typeof seed === 'function' ? seed() : seed; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(seed) { const i = cursor++; return cells[i] ||= { current: seed }; },
    useCallback(fn, deps) { const i = cursor++; if (!cells[i] || different(cells[i].deps, deps)) cells[i] = { deps, value: fn }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || different(cells[i].deps, deps)) { cells[i] = { deps }; effects.push({ i, fn }); } },
    useLayoutEffect(fn, deps) { react.useEffect(fn, deps); },
  };
  const Animated = {
    Value: class { constructor(value) { this.value = value; } setValue(value) { this.value = value; } },
    timing(value, config) {
      const animation = { value, config, at: Date.now(), callback: null, stopped: false,
        start(done) { this.callback = done; },
        stop() { this.stopped = true; this.callback?.({ finished: false }); },
        complete(finished = true) { if (finished) value.setValue(config.toValue); this.callback?.({ finished }); },
      };
      animations.push(animation); return animation;
    },
  };
  const deps = {
    react,
    'react-native': { Animated, Easing: { bezier: () => 'easing' }, AccessibilityInfo: {
      isReduceMotionEnabled: () => query,
      addEventListener(event, fn) { expect(event).toBe('reduceMotionChanged'); listener = fn; return { remove }; },
    } },
  };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, Date, setTimeout, clearTimeout, require: key => { if (!(key in deps)) throw Error(`Unexpected dependency: ${key}`); return deps[key]; } });
  const render = (next = callback) => { callback = next; cursor = 0; result = scope.exports.useLaunchSequence(callback); return result; };
  const effectsNow = async () => { for (const { i, fn } of effects.splice(0)) { cleanups.get(i)?.(); cleanups.set(i, fn()); } await flush(); render(); };
  render(); await effectsNow();
  return { get result() { return result; }, callback, render, effectsNow, animations, remove,
    change(value) { listener(value); render(); },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); render(); },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('bounded launch sequence', () => {
  it('reveals the brand in order and hands off by 2080 ms without a native completion event', async () => {
    const h = await mount();
    expect(h.result.reducedMotion).toBe(false);
    const wordmark = h.animations.find(animation => animation.value === h.result.reveal);
    const tagline = h.animations.find(animation => animation.value === h.result.tagline);
    expect(wordmark.at + wordmark.config.delay).toBe(1050);
    expect(wordmark.config.duration).toBe(300);
    expect(tagline.at + tagline.config.delay).toBe(1280);
    expect(tagline.config.duration).toBe(260);
    expect(h.animations.every(animation => animation.config.useNativeDriver && animation.config.isInteraction === false)).toBe(true);
    await h.advance(1899); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.animations.at(-1).config.duration).toBe(180);
    await h.advance(179); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(1); expect(h.callback).toHaveBeenCalledOnce();
    expect(h.callback).toHaveBeenCalledWith(false);
  });

  it('does not let a delayed preference query shift the normal timeline', async () => {
    const query = pending(), h = await mount(query.promise);
    expect(h.result.reducedMotion).toBeNull();
    await h.advance(100); query.resolve(false); await flush(); h.render();
    const wordmark = h.animations.find(animation => animation.value === h.result.reveal);
    expect(wordmark.at + wordmark.config.delay).toBe(1050);
    await h.advance(1980); expect(h.callback).toHaveBeenCalledOnce();
  });

  it('keeps callback and theme rerenders from extending the deadline and uses the latest callback', async () => {
    const h = await mount(), latest = vi.fn();
    await h.advance(900); h.render(latest); await h.effectsNow();
    await h.advance(1180);
    expect(h.callback).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
  });

  it('never lets early successful artwork completion skip the readable wordmark and tagline', async () => {
    const h = await mount(); h.result.finish(); h.result.finish();
    await h.advance(1539); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(1); expect(h.animations.at(-1).config.duration).toBe(180);
    await h.advance(180); expect(h.callback).toHaveBeenCalledOnce();
  });

  it('completes once when artwork, native exit, and backup callbacks race', async () => {
    const h = await mount(); await h.advance(1700); h.result.finish();
    const exit = h.animations.at(-1);
    exit.complete(); exit.complete(); h.result.finish(); h.result.animationFailed();
    await h.advance(1000); expect(h.callback).toHaveBeenCalledOnce();
  });

  it('uses the exit deadline even if the native exit is interrupted', async () => {
    const h = await mount(); await h.advance(1900); h.animations.at(-1).complete(false);
    await h.advance(179); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(1); expect(h.callback).toHaveBeenCalledOnce();
  });

  it.each(['enabled', 'failed', 'unresolved'])('shows a static readable brand for a %s preference then hands off promptly', async (preference) => {
    const query = pending();
    if (preference === 'enabled') query.resolve(true);
    const h = await mount(query.promise);
    if (preference === 'failed') { query.reject(Error('native preference unavailable')); await flush(); h.render(); }
    if (preference === 'unresolved') await h.advance(120);
    expect(h.result.reducedMotion).toBe(true);
    expect(h.result.reveal.value).toBe(1); expect(h.result.tagline.value).toBe(1);
    expect(h.animations).toHaveLength(0);
    await h.advance(149); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(2); expect(h.callback).toHaveBeenCalledWith(true);
    expect(h.animations.every(animation => animation.config.duration === 1)).toBe(true);
    query.resolve(false); await flush(); h.render();
    expect(h.result.reducedMotion).toBe(true);
  });

  it('does not let a late initial query overwrite a newer reduced-motion event', async () => {
    const query = pending(), h = await mount(query.promise);
    h.change(true); query.resolve(false); await flush(); h.render();
    expect(h.result.reducedMotion).toBe(true);
    await h.advance(151); expect(h.callback).toHaveBeenCalledWith(true);
  });

  it('stops motion immediately on a system change and never replays when motion is re-enabled', async () => {
    const h = await mount(); await h.advance(400);
    h.change(true); expect(h.animations.every(animation => animation.stopped)).toBe(true);
    expect(h.result.reveal.value).toBe(1); expect(h.result.tagline.value).toBe(1);
    h.change(false); expect(h.result.reducedMotion).toBe(true);
    await h.advance(151); expect(h.callback).toHaveBeenCalledWith(true);
  });

  it('makes failed artwork static immediately and leaves enough time to read the brand', async () => {
    const h = await mount(); await h.advance(300); h.result.animationFailed(); h.render();
    expect(h.result.reducedMotion).toBe(true);
    expect(h.result.reveal.value).toBe(1); expect(h.result.tagline.value).toBe(1);
    await h.advance(149); expect(h.callback).not.toHaveBeenCalled();
    await h.advance(2); expect(h.callback).toHaveBeenCalledOnce();
  });

  it('never extends the deadline for a late static fallback', async () => {
    const h = await mount(); await h.advance(1890); h.result.animationFailed();
    await h.advance(190); expect(h.callback).toHaveBeenCalledOnce();
  });

  it.each(['entrance', 'exit'])('cleans up during %s and ignores late native callbacks and preference events', async (phase) => {
    const h = await mount(); if (phase === 'exit') await h.advance(1900);
    h.unmount();
    expect(h.remove).toHaveBeenCalledOnce(); expect(h.animations.every(animation => animation.stopped)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    h.animations.forEach(animation => animation.complete());
    h.change(true); h.result.finish(); h.result.animationFailed();
    await h.advance(3000); expect(h.callback).not.toHaveBeenCalled();
  });

  it('fences a pending initial preference after unmount', async () => {
    const query = pending(), h = await mount(query.promise); h.unmount();
    query.resolve(false); await flush(); h.render();
    expect(h.result.reducedMotion).toBeNull(); expect(h.animations).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
