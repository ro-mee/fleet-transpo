import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const url = new URL('./use-launch-audio.js', import.meta.url);
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

// Run the complete hook; substitute only React scheduling and the native audio boundary.
async function mount({ enabled = false, loaded = true, mode = Promise.resolve(), seek, failure, appState = 'active' } = {}) {
  expect(existsSync(url), 'the launch audio hook must exist').toBe(true);
  const { code } = await transform(readFileSync(url, 'utf8'), { format: 'cjs' });
  const cells = [], effects = [], cleanups = new Map(), plays = [], seeks = [], modes = [];
  let cursor = 0, currentEnabled = enabled, statusListener, appListener, playerCreated = 0;
  let statusRemoved = false, appRemoved = false, released = false, playing = false;
  const different = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return cells[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || different(cells[i].deps, deps)) { cells[i] = { deps }; effects.push({ i, fn }); } },
    useLayoutEffect(fn, deps) { react.useEffect(fn, deps); },
  };
  const player = {
    isLoaded: loaded, loop: true, volume: 1,
    addListener(event, fn) { expect(event).toBe('playbackStatusUpdate'); statusListener = fn; return { remove() { statusRemoved = true; } }; },
    seekTo(seconds, before, after) { seeks.push({ seconds, before, after }); if (failure === 'seek') return Promise.reject(Error('seek failed')); return seek || Promise.resolve(); },
    play() { if (failure === 'play') throw Error('play failed'); playing = true; plays.push({ at: Date.now(), seconds: seeks.at(-1)?.seconds || 0 }); },
    pause() { playing = false; if (failure === 'pause') throw Error('pause failed'); },
    release() { released = true; playing = false; if (failure === 'release') throw Error('release failed'); },
  };
  const AppState = {
    currentState: appState,
    addEventListener(event, fn) { expect(event).toBe('change'); appListener = fn; return { remove() { appRemoved = true; } }; },
  };
  const audio = {
    createAudioPlayer(source, options) { expect(source).toBe(42); expect(options.keepAudioSessionActive).toBe(false); if (failure === 'create') throw Error('create failed'); playerCreated += 1; return player; },
    setAudioModeAsync(config) { modes.push(config); if (failure === 'mode') return Promise.reject(Error('mode failed')); return mode; },
  };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, Date, setTimeout, clearTimeout,
    require(key) {
      if (key === 'react') return react;
      if (key === 'react-native') return { AppState };
      if (key === '../assets/audio/hotel-route-launch.wav') return 42;
      if (key === 'expo-audio') { if (failure === 'missing-module') throw Error('Cannot find native module ExpoAudio'); return audio; }
      throw Error(`Unexpected dependency: ${key}`);
    },
  });
  const render = (next = currentEnabled) => { currentEnabled = next; cursor = 0; scope.exports.useLaunchAudio(next); };
  const effectsNow = async () => { for (const { i, fn } of effects.splice(0)) { cleanups.get(i)?.(); cleanups.set(i, fn()); } await flush(); };
  render(); await effectsNow();
  return {
    plays, seeks, modes, player, render, effectsNow,
    get playerCreated() { return playerCreated; }, get playing() { return playing; },
    get released() { return released; }, get statusRemoved() { return statusRemoved; }, get appRemoved() { return appRemoved; },
    async enable(value = true) { render(value); await effectsNow(); },
    load() { player.isLoaded = true; statusListener?.({ isLoaded: true }); },
    state(value) { AppState.currentState = value; appListener?.(value); },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('optional launch audio', () => {
  it('preloads silently, then plays once without interrupting other audio or silent mode', async () => {
    const h = await mount();
    expect(h.playerCreated).toBe(1); expect(h.plays).toEqual([]);
    expect(h.modes).toEqual([{
      playsInSilentMode: false, interruptionMode: 'mixWithOthers', allowsRecording: false,
      shouldPlayInBackground: false, shouldRouteThroughEarpiece: false, allowsBackgroundRecording: false,
    }]);
    await h.advance(80); await h.enable();
    expect(h.plays).toEqual([{ at: 80, seconds: 0 }]);
    expect(h.player.loop).toBe(false); expect(h.player.volume).toBeLessThanOrEqual(0.6);
    await h.advance(400); await h.enable(); h.load(); await flush();
    expect(h.plays).toHaveLength(1); expect(h.playerCreated).toBe(1);
    h.unmount(); expect(h.playing).toBe(false); expect(h.released).toBe(true);
    expect(h.statusRemoved).toBe(true); expect(h.appRemoved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for both native mode and asset, then seeks to the animation time', async () => {
    const mode = pending(), h = await mount({ enabled: true, loaded: false, mode: mode.promise });
    await h.advance(40); h.load(); await flush(); expect(h.plays).toEqual([]);
    await h.advance(30); mode.resolve(); await flush();
    expect(h.seeks).toEqual([{ seconds: 0.07, before: 0, after: 0 }]);
    expect(h.plays).toEqual([{ at: 70, seconds: 0.07 }]); h.unmount();
  });

  it('starts after an early asynchronous load even when the mode is already ready', async () => {
    const h = await mount({ enabled: true, loaded: false });
    await h.advance(90); h.load(); await flush();
    expect(h.plays).toEqual([{ at: 90, seconds: 0.09 }]); h.unmount();
  });

  it.each(['asset', 'mode', 'seek'])('permanently skips a %s that is ready after the 180 ms window', async (boundary) => {
    const delay = pending(), h = await mount({ enabled: true, loaded: boundary !== 'asset', mode: boundary === 'mode' ? delay.promise : Promise.resolve(), seek: boundary === 'seek' ? delay.promise : undefined });
    await h.advance(181); h.load(); delay.resolve(); await flush();
    await h.enable(false); await h.enable(true); h.state('active');
    expect(h.plays).toEqual([]); expect(vi.getTimerCount()).toBe(0); h.unmount();
  });

  it('skips a seek that would make letter arrivals noticeably late', async () => {
    const seek = pending(), h = await mount({ enabled: true, seek: seek.promise });
    await h.advance(60); seek.resolve(); await flush();
    expect(h.plays).toEqual([]); h.unmount();
  });

  it.each(['background', 'inactive'])('stops on %s and never replays when foregrounded', async (state) => {
    const h = await mount({ enabled: true }); expect(h.playing).toBe(true);
    h.state(state); expect(h.playing).toBe(false);
    h.state('active'); h.load(); await h.enable(); await flush();
    expect(h.plays).toHaveLength(1); h.unmount();
  });

  it.each(['background', 'disable', 'unmount'])('fences a pending seek after %s', async (action) => {
    const seek = pending(), h = await mount({ enabled: true, seek: seek.promise });
    if (action === 'background') h.state('background');
    if (action === 'disable') await h.enable(false);
    if (action === 'unmount') h.unmount();
    seek.resolve(); await flush(); h.load(); h.state('active'); await h.enable(true);
    expect(h.plays).toEqual([]); h.unmount();
  });

  it('fences pending loading and mode after unmount, including stale native callbacks', async () => {
    const mode = pending(), h = await mount({ enabled: true, loaded: false, mode: mode.promise });
    h.unmount(); mode.resolve(); h.load(); await flush();
    expect(h.plays).toEqual([]); expect(h.seeks).toEqual([]); expect(h.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, null])('does not play for the disabled or unresolved preference %s', async (enabled) => {
    const h = await mount({ enabled }); await h.advance(3000); h.load(); await flush();
    expect(h.plays).toEqual([]); expect(vi.getTimerCount()).toBe(0); h.unmount();
  });

  it('skips a launch mounted in background and does not wait for foreground', async () => {
    const h = await mount({ enabled: true, appState: 'background' });
    h.state('active'); await flush(); expect(h.plays).toEqual([]); h.unmount();
  });

  it.each(['missing-module', 'create', 'mode', 'seek', 'play', 'pause', 'release'])('keeps %s failure away from the launch path', async (failure) => {
    const h = await mount({ enabled: true, failure });
    await h.advance(200); expect(() => h.unmount()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    if (!['pause', 'release'].includes(failure)) expect(h.plays).toEqual([]);
  });
});
