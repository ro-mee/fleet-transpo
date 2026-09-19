import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// Exercise the real launch lifecycle without requiring a native renderer.
const source = readFileSync('mobile/components/LaunchScreen.js', 'utf8');
const lifecycle = source.slice(source.indexOf('export function LaunchScreen'), source.indexOf('  const translateY'))
  .replace('export function', 'function') + 'return finish; }';

function mount(preference) {
  const effects = [], timers = [], timings = [];
  const stopped = vi.fn(), complete = vi.fn();
  const context = {
    useTheme: () => ({ colors:{} }),
    useState: value => [value === null ? preference : value(), vi.fn()],
    useRef: value => ({ current:value }),
    useCallback: fn => fn,
    useEffect: fn => effects.push(fn),
    AccessibilityInfo: { isReduceMotionEnabled:async()=>preference, addEventListener:()=>({remove:vi.fn()}) },
    Animated: {
      Value: class {},
      timing: (_,config) => { timings.push(config); return {start:callback=>callback?.({finished:true})}; },
      parallel: () => ({ start:vi.fn(), stop:stopped }),
    },
    Easing: { bezier:()=>null },
    setTimeout: (callback,delay) => { timers.push({callback,delay}); return timers.length; },
    clearTimeout: vi.fn(),
  };
  vm.runInNewContext(lifecycle + '; this.mount = LaunchScreen;', context);
  const finish = context.mount({ onComplete:complete });
  const cleanup = effects.map(effect=>effect());
  return { finish, complete, timers, timings, stopped, cleanup };
}

it('bounds launch time, uses native non-blocking motion, and completes once even when finish events race', () => {
  const launch = mount(false);
  expect(source).not.toContain('car animation.json');
  expect(launch.timers[0].delay).toBeLessThanOrEqual(1100);
  expect(launch.timings.every(config=>config.useNativeDriver && config.isInteraction === false)).toBe(true);
  launch.finish();
  launch.timers[0].callback();
  expect(launch.complete).toHaveBeenCalledTimes(1);
  expect(launch.timings.at(-1).duration).toBe(180);
  launch.cleanup.forEach(cleanup=>cleanup?.());
  expect(launch.stopped).toHaveBeenCalledOnce();
});

it('waits for the motion preference and uses an almost immediate reduced-motion handoff', () => {
  expect(mount(null).timers).toEqual([]);
  const launch = mount(true);
  expect(launch.timers[0].delay).toBe(150);
  launch.finish();
  expect(launch.timings.every(config=>config.duration === 1)).toBe(true);
  expect(launch.complete).toHaveBeenCalledWith(true);
});
