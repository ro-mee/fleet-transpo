import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ platform: 'android', native: null, change: null, removed: false }));
vi.mock('react-native', () => ({ Platform: { get OS() { return boundary.platform; } }, AppState: {
  addEventListener: (_, change) => { boundary.change = change; return { remove() { boundary.removed = true; } }; },
} }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => boundary.native }));

// Native APIs cannot execute in Node; only that device boundary is replaced.
const load = () => import('./trip-bubble');
beforeEach(() => { vi.resetModules(); boundary.platform = 'android'; boundary.native = {
  canDrawOverlays: async () => true, openOverlaySettings: async () => true,
  showTripBubble: async id => ({ shown: id === '7' }), hideTripBubble: async () => {},
}; });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('optional trip bubble boundary', () => {
  it('reports permission and acknowledges the native window', async () => {
    const bubble = await load();
    expect(await bubble.tripBubbleAvailability()).toEqual({ available: true });
    expect(await bubble.showTripBubble(7)).toEqual({ shown: true });
  });
  it('reports denial without assuming settings granted access', async () => {
    boundary.native.canDrawOverlays = async () => false;
    const bubble = await load();
    expect(await bubble.tripBubbleAvailability()).toEqual({ available: false, reason: 'permission-denied' });
    const result = bubble.requestTripBubblePermission(); await flush();
    boundary.change('background'); boundary.change('active');
    expect(await result).toEqual({ granted: false });
    expect(boundary.removed).toBe(true);
  });
  it('waits for settings return and checks actual permission even when open settles late', async () => {
    let granted = false, opened;
    boundary.native.canDrawOverlays = async () => granted;
    boundary.native.openOverlaySettings = () => new Promise(resolve => { opened = resolve; });
    const bubble = await load(), result = bubble.requestTripBubblePermission(); await flush();
    boundary.change('inactive'); granted = true; boundary.change('active');
    expect(await result).toEqual({ granted: true });
    opened(true);
  });
  it.each(['false', 'rejected'])('continues after settings open is %s without waiting for departure', async kind => {
    boundary.native.canDrawOverlays = async () => false;
    boundary.native.openOverlaySettings = async () => { if (kind === 'rejected') throw new Error('settings unavailable'); return false; };
    expect(await (await load()).requestTripBubblePermission()).toEqual({ granted: false });
  });
  it.each(['ios', 'web', 'missing'])('safely disables the bubble on %s', async platform => {
    boundary.platform = platform === 'missing' ? 'android' : platform;
    if (platform === 'missing') boundary.native = null;
    const bubble = await load();
    expect(await bubble.tripBubbleAvailability()).toEqual({ available: false, reason: 'unsupported' });
    expect(await bubble.requestTripBubblePermission()).toEqual({ granted: false });
    expect(await bubble.showTripBubble(7)).toEqual({ shown: false, reason: 'unsupported' });
    await expect(bubble.hideTripBubble()).resolves.toBeUndefined();
  });
  it.each([null, '', '  ', {}, NaN])('rejects invalid trip identity %j', async id => {
    expect(await (await load()).showTripBubble(id)).toEqual({ shown: false, reason: 'invalid-trip' });
  });
  it('normalizes platform rejection and tolerates repeated hide', async () => {
    for (const key of Object.keys(boundary.native)) boundary.native[key] = async () => { throw new Error('native unavailable'); };
    const bubble = await load();
    expect(await bubble.tripBubbleAvailability()).toEqual({ available: false, reason: 'start-failed' });
    expect(await bubble.requestTripBubblePermission()).toEqual({ granted: false });
    expect(await bubble.showTripBubble(7)).toEqual({ shown: false, reason: 'start-failed' });
    await bubble.hideTripBubble(); await expect(bubble.hideTripBubble()).resolves.toBeUndefined();
  });
});
