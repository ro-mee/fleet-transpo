import { describe, expect, it, vi } from 'vitest';
import { createTripBubbleHandoff, offerTripBubble } from './trip-bubble-handoff';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function permissionFlow({ available = false, saved = null, granted = false } = {}) {
  const data = new Map(saved ? [['fleetops-trip-bubble-offered-v1', saved]] : []);
  let dialog, current = true;
  const request = vi.fn(async () => ({ granted }));
  const options = {
    availability: async () => available ? { available: true } : { available: false, reason: 'permission-denied' }, request,
    storage: { getItem: async key => data.get(key), setItem: async (key, value) => { data.set(key, value); } },
    alert: (...args) => { dialog = args; }, isCurrent: () => current,
  };
  return { options, request, data, dialog: () => dialog, invalidate: () => { current = false; } };
}

describe('first-use trip bubble choice', () => {
  it.each(['not-now', 'dismiss'])('persists %s and continues without another offer', async choice => {
    const h = permissionFlow(), pending = offerTripBubble(h.options); await flush();
    const [, , buttons, options] = h.dialog();
    expect(options.buttonLayout).toBe('stacked');
    expect(buttons.map(button => button.text)).toEqual(['Not now', 'Open Android settings']);
    if (choice === 'dismiss') options.onDismiss(); else buttons[0].onPress();
    expect(await pending).toBe(false); expect(h.request).not.toHaveBeenCalled();
    expect(await offerTripBubble(h.options)).toBe(false);
    expect(h.data.get('fleetops-trip-bubble-offered-v1')).toBe('1');
  });
  it.each([true, false])('uses actual settings permission %s and ignores dismissal after choosing Settings', async granted => {
    const h = permissionFlow({ granted }), pending = offerTripBubble(h.options); await flush();
    h.dialog()[2][1].onPress(); h.dialog()[3].onDismiss();
    expect(await pending).toBe(granted); expect(h.request).toHaveBeenCalledOnce();
  });
  it('never offers on unsupported builds or stored choices; existing permission works', async () => {
    const h = permissionFlow({ saved: '1' });
    expect(await offerTripBubble(h.options)).toBe(false); expect(h.dialog()).toBeUndefined();
    h.options.availability = async () => ({ available: false, reason: 'unsupported' });
    expect(await offerTripBubble(h.options)).toBe(false); expect(h.dialog()).toBeUndefined();
    h.options.availability = async () => ({ available: true });
    expect(await offerTripBubble(h.options)).toBe(true);
  });
  it('refuses settings and the bubble when the trip changes during the explanation', async () => {
    const h = permissionFlow({ granted: true }), pending = offerTripBubble(h.options); await flush();
    h.invalidate(); h.dialog()[2][1].onPress();
    expect(await pending).toBe(false); expect(h.request).not.toHaveBeenCalled();
  });
  it('skips the offer if its choice cannot be saved', async () => {
    const h = permissionFlow(); h.options.storage.setItem = async () => { throw new Error('disk full'); };
    expect(await offerTripBubble(h.options)).toBe(false); expect(h.dialog()).toBeUndefined();
  });
});

describe('trip bubble handoff lifecycle', () => {
  function setup() {
    const calls = []; let current = true;
    const controller = createTripBubbleHandoff({ show: async id => { calls.push(`show:${id}`); return { shown: true }; }, hide: async () => { calls.push('hide'); } });
    return { calls, controller, arm: () => controller.arm(7, () => current), invalidate: () => { current = false; } };
  }
  it.each(['open-first', 'leave-first'])('requires success and actual departure: %s', async order => {
    const h = setup(), token = h.arm();
    if (order === 'open-first') h.controller.launched(token); else h.controller.depart();
    await flush(); expect(h.calls).toEqual([]);
    if (order === 'open-first') h.controller.depart(); else h.controller.launched(token);
    h.controller.depart(); h.controller.launched(token); await flush();
    expect(h.calls).toEqual(['show:7']);
    await h.controller.returnToApp(); expect(h.calls).toEqual(['show:7', 'hide']);
  });
  it('never shows during settings or ordinary departures', async () => {
    const h = setup(); h.controller.depart(); await h.controller.returnToApp();
    expect(h.calls).toEqual(['hide']);
  });
  it.each(['return', 'failed', 'stale'])('cancels %s before a late platform success', async reason => {
    const h = setup(), token = h.arm(); h.controller.depart();
    if (reason === 'return') await h.controller.returnToApp();
    if (reason === 'failed') await h.controller.failed(token);
    if (reason === 'stale') { h.invalidate(); await h.controller.invalidate(); }
    h.controller.launched(token); await flush(); expect(h.calls).toEqual(['hide']);
  });
  it('hides synchronously while native show acknowledgement is still pending', async () => {
    const pending = deferred(), calls = [];
    const controller = createTripBubbleHandoff({ show: () => { calls.push('show'); return pending.promise; }, hide: async () => { calls.push('hide'); } });
    const token = controller.arm(7, () => true); controller.launched(token); controller.depart();
    const hidden = controller.returnToApp(); expect(calls).toEqual(['show', 'hide']);
    pending.resolve({ shown: false }); await hidden; await flush(); expect(calls).toEqual(['show', 'hide']);
  });
  it('does not turn a later unrelated departure into a Maps bubble', async () => {
    vi.useFakeTimers();
    try {
      const h = setup(), token = h.arm(); h.controller.launched(token);
      vi.advanceTimersByTime(6000); h.controller.depart(); await flush();
      expect(h.calls).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
