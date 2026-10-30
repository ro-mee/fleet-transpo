import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beginNavigationHandoff } from './navigation-handoff';
import { navigationTarget, externalNavigationUrl } from './navigation-route';
import { launchExternalNavigation } from './external-navigation';
import { createTripBubbleHandoff } from './trip-bubble-handoff';
import { legForStatus } from './trip-navigation-phase';

const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
const trip = { trip_id: 7, trip_status: 'En Route', destination_latitude: 14.7, destination_longitude: 121.1 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// The screen awaits the single owner's background readiness before Maps opens.
// Owner/native permission, cleanup and mileage tests live in the owner suites.
function screen(value = trip, permission = async () => ({ ok: true })) {
  const activeTripRef = { current: value }, navigationBusyRef = { current: false };
  const openURL = vi.fn().mockResolvedValue(undefined), alert = vi.fn(), probe = vi.fn(permission);
  const cancelTripNavigation = vi.fn().mockResolvedValue({ ok: true });
  const setNavigationBusy = vi.fn();
  const bubbleCalls = [], saved = new Map();
  const availability = vi.fn(async () => ({ available: false, reason: 'unsupported' }));
  const request = vi.fn(async () => ({ granted: false }));
  const tripBubbleRef = { current: createTripBubbleHandoff({
    show: async id => { bubbleCalls.push(`show:${id}`); return { shown: true }; },
    hide: async () => { bubbleCalls.push('hide'); }, availability, request,
    storage: { getItem: async key => saved.get(key), setItem: async (key, value) => { saved.set(key, value); } }, alert,
  }) };
  let sessionCurrent = true;
  const context = { activeTripRef, navigationBusyRef, navigationOperationRef: { current: null }, setNavigationBusy, appState: { current: 'active' },
    user: { employeeId: 23 }, captureCargoSession: () => ({}), isCurrentCargoSession: () => sessionCurrent,
    navigationTarget, externalNavigationUrl, beginNavigationHandoff, launchExternalNavigation, prepareTripNavigation: probe, cancelTripNavigation, legForStatus,
    useCallback: fn => fn,
    isGpsTrackedTrip: value => value && ['Driver Accepted', 'Trip Started', 'At Pickup', 'En Route'].includes(value.trip_status),
    Linking: { openURL }, AppAlert: { alert },
    loadTripRef: { current: vi.fn() }, tripBubbleRef,
  };
  const start = source.indexOf('  const openExternalNavigation =');
  const end = source.indexOf('  const handleMapReady', start);
  const action = runInNewContext(`${source.slice(start, end)}; openExternalNavigation`, context);
  return { action, activeTripRef, navigationBusyRef, openURL, alert, probe, cancelTripNavigation, setNavigationBusy, context, bubbleCalls, availability, request, endSession: () => { sessionCurrent = false; } };
}

function attachLifecycle(h) {
  let change, unmount;
  const start = source.indexOf('  const appState = useRef(AppState.currentState);');
  const end = source.indexOf('  const prevTripIdsRef', start);
  runInNewContext(source.slice(start, end), { ...h.context,
    useRef: () => h.context.appState, useEffect: fn => { unmount = fn(); },
    AppState: { currentState: 'active', addEventListener: (_, fn) => { change = fn; return { remove() {} }; } },
  });
  change.unmount = () => unmount();
  return change;
}

describe('Map handoff actions', () => {
  it('does not rearm a paused availability offer after an ordinary foreground return', async () => {
    const available = deferred(), h = screen(); h.availability.mockImplementation(() => available.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    expect(h.availability).toHaveBeenCalledOnce(); expect(h.openURL).not.toHaveBeenCalled();
    change('background'); change('active'); available.resolve({ available: true }); await running;
    change('background'); await flush();
    expect(h.bubbleCalls).toEqual(['hide']); expect(h.navigationBusyRef.current).toBe(false);
    expect(h.openURL).toHaveBeenCalledOnce();
  });
  it('invalidates an undecided alert on return before its later Settings choice', async () => {
    const h = screen(); h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); await h.alert.mock.calls[0][2][1].onPress(); await running;
    change('background'); await flush();
    expect(h.request).not.toHaveBeenCalled(); expect(h.bubbleCalls).toEqual(['hide']);
    expect(h.navigationBusyRef.current).toBe(false);
  });
  it('invalidates the actual Settings request when Map unmounts', async () => {
    const h = screen(), permission = deferred(); h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    h.request.mockImplementation(() => permission.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    h.alert.mock.calls[0][2][1].onPress(); change.unmount();
    permission.resolve({ granted: true }); await running;
    change('background'); await flush();
    expect(h.bubbleCalls).toEqual(['hide']); expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each(['open-first', 'leave-first'])('shows only after a tracked Maps handoff and real departure: %s', async order => {
    const h = screen(), opened = deferred(); h.availability.mockResolvedValue({ available: true });
    h.openURL.mockImplementation(() => opened.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    expect(h.bubbleCalls).toEqual([]);
    if (order === 'open-first') { opened.resolve(); await running; } else change('background');
    await flush(); expect(h.bubbleCalls).toEqual([]);
    if (order === 'open-first') change('background'); else { opened.resolve(); await running; }
    await flush(); expect(h.bubbleCalls).toEqual(['show:7']);
    change('active'); await flush();
    expect(h.bubbleCalls).toEqual(['show:7', 'hide']);
  });
  it('offers only after readiness, holds duplicate taps, and treats replacement as Not now', async () => {
    const ready = deferred(), h = screen(trip, () => ready.promise);
    h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    const running = h.action(); await flush(); expect(h.alert).not.toHaveBeenCalled();
    ready.resolve({ ok: true }); await flush();
    expect(h.alert).toHaveBeenCalledOnce(); expect(h.openURL).not.toHaveBeenCalled();
    await h.action(); h.alert.mock.calls[0][3].onDismiss(); await running;
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(false);
    await h.action(); expect(h.alert).toHaveBeenCalledOnce(); expect(h.openURL).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])('does not mistake settings for Maps, then uses the actual permission result: %s', async granted => {
    const h = screen(), permission = deferred(); h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    h.request.mockImplementation(() => permission.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    h.alert.mock.calls[0][2][1].onPress(); h.alert.mock.calls[0][3].onDismiss();
    change('background'); change('active'); await flush(); expect(h.bubbleCalls).toEqual(['hide']); expect(h.openURL).not.toHaveBeenCalled();
    permission.resolve({ granted }); await running;
    expect(h.bubbleCalls).toEqual(['hide']); change('background'); await flush();
    expect(h.bubbleCalls).toEqual(granted ? ['hide', 'show:7'] : ['hide']);
    expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each(['permission-denied', 'start-failed'])('requires an explicit untracked choice when readiness is lost during shortcut Settings: %s', async reason => {
    const h = screen(), permission = deferred();
    h.probe.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason });
    h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    h.request.mockImplementation(() => permission.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    h.alert.mock.calls[0][2][1].onPress();
    change('background'); change('active'); permission.resolve({ granted: true }); await running;
    expect(h.probe).toHaveBeenNthCalledWith(2, { tripId: 7, leg: 'leg2', requestPermission: false });
    expect(h.openURL).not.toHaveBeenCalled();
    expect(h.navigationBusyRef.current).toBe(true);
    const [title, , buttons] = h.alert.mock.calls[1];
    expect(title).toMatch(/tracking unavailable/i);
    expect(buttons.map(button => button.text)).toEqual(['Stay Here', 'Continue Without Tracking']);
    await h.action(); expect(h.probe).toHaveBeenCalledTimes(2);
    await buttons[1].onPress(); await buttons[1].onPress();
    expect(h.openURL).toHaveBeenCalledOnce();
    expect(h.probe).toHaveBeenCalledTimes(2);
    change('background'); await flush();
    expect(h.bubbleCalls).toEqual(['hide']);
    expect(h.navigationBusyRef.current).toBe(false);
  });
  it('holds duplicate navigation taps through the final readiness check after the optional offer', async () => {
    const h = screen(), finalReady = deferred();
    h.probe.mockResolvedValueOnce({ ok: true }).mockImplementationOnce(() => finalReady.promise);
    const running = h.action(); await flush();
    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(h.openURL).not.toHaveBeenCalled();
    await h.action(); expect(h.probe).toHaveBeenCalledTimes(2);
    finalReady.resolve({ ok: true }); await running;
    expect(h.openURL).toHaveBeenCalledOnce();
    expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each(['permission-denied', 'start-failed'])('never offers or shows on the explicit untracked override after %s', async reason => {
    const h = screen(trip, async () => ({ ok: false, reason }));
    h.availability.mockResolvedValue({ available: true }); const change = attachLifecycle(h);
    await h.action(); await h.alert.mock.calls[0][2][1].onPress(); change('background'); await flush();
    expect(h.availability).not.toHaveBeenCalled(); expect(h.bubbleCalls).toEqual([]);
  });
  it('cancels a late successful launch after FleetOps has already returned', async () => {
    const h = screen(), opened = deferred(); h.availability.mockResolvedValue({ available: true });
    h.openURL.mockImplementation(() => opened.promise); const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); opened.resolve(); await running;
    expect(h.bubbleCalls).toEqual(['hide']); expect(h.navigationBusyRef.current).toBe(false);
  });
  it('awaits shortcut removal before releasing a failed-launch rollback', async () => {
    const h = screen(), hidden = deferred(); let rejectOpen;
    h.context.tripBubbleRef.current = createTripBubbleHandoff({
      show: async () => ({ shown: true }), hide: () => hidden.promise, availability: async () => ({ available: true }),
    });
    h.openURL.mockImplementation(() => new Promise((_, reject) => { rejectOpen = reject; }));
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); rejectOpen(new Error('launch failed')); await flush();
    expect(h.cancelTripNavigation).not.toHaveBeenCalled();
    hidden.resolve(); await running;
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(false);
    expect(h.cancelTripNavigation).toHaveBeenCalledWith({ tripId: 7, leg: 'leg2' });
  });
  it.each(['denied', 'failed'])('continues Maps after settings is %s without arming the bubble', async result => {
    const h = screen(); h.availability.mockResolvedValue({ available: false, reason: 'permission-denied' });
    if (result === 'failed') h.request.mockRejectedValue(new Error('settings failed'));
    const running = h.action(); await flush(); h.alert.mock.calls[0][2][1].onPress(); await running;
    const change = attachLifecycle(h); change('background'); await flush();
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.bubbleCalls).toEqual([]); expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each(['ended', 'session-ended'])('does not show after %s while launch is pending', async kind => {
    const h = screen(), opened = deferred(); h.availability.mockResolvedValue({ available: true });
    h.openURL.mockImplementation(() => opened.promise); const change = attachLifecycle(h), running = h.action(); await flush();
    change('background');
    if (kind === 'ended') h.activeTripRef.current = { ...trip, trip_status: 'Completed' }; else h.endSession();
    opened.resolve(); await running; expect(h.bubbleCalls).toEqual([]);
  });
  it('clears an earlier undispatched bubble before a new untracked override', async () => {
    const h = screen(); h.availability.mockResolvedValue({ available: true });
    await h.action();
    h.probe.mockResolvedValue({ ok: false, reason: 'permission-denied' });
    const change = attachLifecycle(h); await h.action(); await h.alert.mock.calls[0][2][1].onPress();
    change('background'); await flush(); expect(h.bubbleCalls).toEqual(['hide']);
  });
  it('holds the tap lock until readiness and launches once', async () => {
    const pending = deferred(), h = screen(trip, () => pending.promise);
    const first = h.action(); await h.action();
    await flush();
    expect(h.probe).toHaveBeenCalledOnce(); expect(h.openURL).not.toHaveBeenCalled();
    expect(h.probe).toHaveBeenCalledWith({ tripId: 7, leg: 'leg2', requestPermission: true });
    expect(h.navigationBusyRef.current).toBe(true);
    pending.resolve({ ok: true }); await first;
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each([
    ['permission-denied', () => screen(trip, async () => ({ ok: false, reason: 'permission-denied' })), 1],
    ['start-failed', () => screen(trip, async () => ({ ok: false, reason: 'start-failed' })), 1],
    ['unsupported', () => screen({ ...trip, trip_status: 'Assigned', origin_latitude: 14.6, origin_longitude: 121 }), 0],
  ])('offers a safe choice after %s', async (reason, build, probeCalls) => {
    const h = build();
    await h.action();
    const [title, message, buttons, options] = h.alert.mock.calls[0];
    expect(title).toMatch(/tracking unavailable/i); expect(message).toMatch(/cannot confirm live tracking/i);
    expect(buttons.map(button => button.text)).toEqual(['Stay Here', 'Continue Without Tracking']);
    expect(buttons[0].style).not.toBe('destructive'); expect(options.buttonLayout).toBe('stacked');
    await h.action(); expect(h.probe).toHaveBeenCalledTimes(probeCalls);
    buttons[0].onPress(); expect(h.openURL).not.toHaveBeenCalled(); expect(h.navigationBusyRef.current).toBe(false);
  });
  it('opens only after the explicit untracked choice and ignores duplicate warning activation', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'permission-denied' }));
    await h.action(); const buttons = h.alert.mock.calls[0][2];
    expect(h.openURL).not.toHaveBeenCalled();
    await buttons[1].onPress(); await buttons[1].onPress();
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.probe).toHaveBeenCalledOnce();
  });
  it('releases the warning tap lock when dismissed with Back', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'permission-denied' }));
    await h.action(); h.alert.mock.calls[0][3].onDismiss();
    expect(h.navigationBusyRef.current).toBe(false); expect(h.openURL).not.toHaveBeenCalled();
  });
  it('requires explicit untracked navigation before acceptance without requesting tracking', async () => {
    const h = screen({ ...trip, trip_status: 'Assigned', origin_latitude: 14.6, origin_longitude: 121 });
    await h.action(); expect(h.probe).not.toHaveBeenCalled(); expect(h.openURL).not.toHaveBeenCalled();
    await h.alert.mock.calls[0][2][1].onPress(); expect(h.openURL).toHaveBeenCalledOnce();
  });
  it.each(['completed', 'changed-target', 'session-ended'])('rejects %s during readiness', async kind => {
    const pending = deferred(), h = screen(trip, () => pending.promise), running = h.action();
    await flush();
    if (kind === 'completed') h.activeTripRef.current = null;
    if (kind === 'changed-target') h.activeTripRef.current = { ...trip, destination_latitude: 15 };
    if (kind === 'session-ended') h.endSession();
    pending.resolve({ ok: true }); await running;
    expect(h.openURL).not.toHaveBeenCalled();
  });
  it('rejects a completed trip when the warning override is selected later', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'permission-denied' }));
    await h.action(); h.activeTripRef.current = null;
    await h.alert.mock.calls[0][2][1].onPress(); expect(h.openURL).not.toHaveBeenCalled();
  });
  it('reports platform open failure and releases the handoff', async () => {
    const h = screen(); h.openURL.mockRejectedValue(new Error('no handler'));
    await h.action(); expect(h.alert.mock.calls[0][1]).toMatch(/Unable to open Google Maps/);
    expect(h.cancelTripNavigation).toHaveBeenCalledWith({ tripId: 7, leg: 'leg2' });
  });
  it('retains the Dispatch verification message for invalid targets', async () => {
    const h = screen({ ...trip, destination_latitude: null }); await h.action();
    expect(h.probe).not.toHaveBeenCalled(); expect(h.openURL).not.toHaveBeenCalled();
    expect(h.alert.mock.calls[0][1]).toMatch(/Ask Dispatch to verify/);
  });
  it('cleans up a real Maps return even if the platform open promise settles late', async () => {
    const opened = deferred(), h = screen(); h.openURL.mockImplementation(() => opened.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); await flush();
    expect(h.navigationBusyRef.current).toBe(true);
    opened.resolve(); await running;
    expect(h.navigationBusyRef.current).toBe(false);
    expect(h.context.loadTripRef.current).toHaveBeenCalledOnce();
  });
});
