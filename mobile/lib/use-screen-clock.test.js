import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeRender } from './test-helpers/native-render';

async function clock(initialState = 'active') {
  let focus, cleanup, listener;
  const remove = vi.fn();
  const h = await nativeRender(new URL('./use-screen-clock.js', import.meta.url), {
    name: 'useScreenClock',
    deps: {
      'expo-router': { useFocusEffect: fn => { focus = fn; } },
      'react-native': { AppState: {
        currentState: initialState,
        addEventListener: (event, fn) => {
          expect(event).toBe('change'); listener = fn; return { remove };
        },
      } },
    },
  });
  return {
    h, remove,
    focus() { cleanup = focus(); h.render(); },
    blur() { cleanup(); h.render(); },
    change(state) { listener(state); h.render(); },
    tick(ms) { vi.advanceTimersByTime(ms); h.render(); },
  };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('focused foreground presentation clock', () => {
  it('keeps the visible 30-second cadence and stops all clock work on blur', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const c = await clock();
    expect(vi.getTimerCount()).toBe(0);
    expect(c.h.result.active).toBe(false);
    c.focus();
    expect(c.h.result).toEqual({ now: 100000, active: true });
    expect(vi.getTimerCount()).toBe(1);
    c.tick(30000);
    expect(c.h.result.now).toBe(130000);
    c.blur();
    expect(vi.getTimerCount()).toBe(0);
    c.tick(90000);
    expect(c.h.result).toEqual({ now: 130000, active: false });
    expect(c.remove).toHaveBeenCalledOnce();
    c.focus();
    expect(c.h.result).toEqual({ now: 220000, active: true });
    expect(vi.getTimerCount()).toBe(1);
    c.blur();
  });

  it('pauses for background/inactive and resumes with fresh time without duplicate intervals', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const c = await clock(); c.focus();
    c.change('inactive');
    expect(c.h.result.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    c.change('background'); c.tick(60000);
    expect(c.h.result.now).toBe(100000);
    c.change('active'); c.change('active');
    expect(c.h.result).toEqual({ now: 160000, active: true });
    expect(vi.getTimerCount()).toBe(1);
    c.blur();
    c.change('active');
    expect(vi.getTimerCount()).toBe(0);
    expect(c.h.result.active).toBe(false);
  });

  it.each(['background', 'inactive', null])('does not start work before a positively active app state: %s', async state => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const c = await clock(state); c.focus();
    expect(c.h.result.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    c.tick(60000); c.change('active');
    expect(c.h.result).toEqual({ now: 160000, active: true });
    c.blur();
  });
});
