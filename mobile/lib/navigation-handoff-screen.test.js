import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beginNavigationHandoff } from './navigation-handoff';
import { navigationTarget, externalNavigationUrl } from './navigation-route';
import { launchExternalNavigation } from './external-navigation';
import { legForStatus } from './trip-navigation-phase';

const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
const trip = { trip_id: 7, trip_status: 'En Route', destination_latitude: 14.7, destination_longitude: 121.1 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function screen(value = trip, prepare = async () => ({ ok: true })) {
  const activeTripRef = { current: value }, navigationBusyRef = { current: false };
  const openURL = vi.fn().mockResolvedValue(undefined), alert = vi.fn(), stop = vi.fn().mockResolvedValue({ ok: true });
  const prepareBackgroundTracking = vi.fn(prepare), setNavigationBusy = vi.fn();
  let sessionCurrent = true;
  const context = { activeTripRef, navigationBusyRef, navigationOperationRef: { current: null }, setNavigationBusy, appState: { current: 'active' }, trackingTransitionRef: { current: Promise.resolve() },
    user: { employeeId: 23 }, captureCargoSession: () => ({}), isCurrentCargoSession: () => sessionCurrent,
    navigationTarget, externalNavigationUrl, beginNavigationHandoff, launchExternalNavigation, prepareBackgroundTracking, stopBackgroundTracking: stop,
    isGpsTrackedTrip: value => value && ['Driver Accepted', 'Trip Started', 'At Pickup', 'En Route'].includes(value.trip_status),
    Linking: { openURL }, AppAlert: { alert }, trustedTarget: navigationTarget(value),
    mergeStoredKm: async () => {}, distRef: { current: {} }, loadTripRef: { current: vi.fn() },
  };
  const start = source.indexOf('  const openExternalNavigation =');
  const end = source.indexOf('  const handleMapReady', start);
  const action = runInNewContext(`${source.slice(start, end)}; openExternalNavigation`, context);
  return { action, activeTripRef, navigationBusyRef, openURL, alert, stop, prepareBackgroundTracking, setNavigationBusy, context, endSession: () => { sessionCurrent = false; } };
}

function attachLifecycle(h) {
  let change;
  const start = source.indexOf('  const appState = useRef(AppState.currentState);');
  const end = source.indexOf('  const prevTripIdsRef', start);
  runInNewContext(source.slice(start, end), { ...h.context,
    useRef: () => h.context.appState, useEffect: fn => fn(),
    AppState: { currentState: 'active', addEventListener: (_, fn) => { change = fn; return { remove() {} }; } },
    legForStatus, updateLegContext: async () => {}, mergeStoredKm: async () => {}, distRef: { current: {} },
  });
  return change;
}

describe('Map handoff actions', () => {
  it('holds the tap lock until readiness and launches once', async () => {
    const pending = deferred(), h = screen(trip, () => pending.promise);
    const first = h.action(); await h.action();
    expect(h.prepareBackgroundTracking).toHaveBeenCalledOnce(); expect(h.openURL).not.toHaveBeenCalled();
    expect(h.navigationBusyRef.current).toBe(true);
    pending.resolve({ ok: true }); await first;
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(false);
  });
  it.each(['permission-denied', 'start-failed', 'unsupported'])('offers a safe choice after %s', async reason => {
    const h = screen(trip, async () => ({ ok: false, reason }));
    await h.action();
    const [title, message, buttons, options] = h.alert.mock.calls[0];
    expect(title).toMatch(/tracking unavailable/i); expect(message).toMatch(/cannot confirm live tracking/i);
    expect(buttons.map(button => button.text)).toEqual(['Stay Here', 'Continue Without Tracking']);
    expect(buttons[0].style).not.toBe('destructive'); expect(options.buttonLayout).toBe('stacked');
    await h.action(); expect(h.prepareBackgroundTracking).toHaveBeenCalledOnce();
    buttons[0].onPress(); expect(h.openURL).not.toHaveBeenCalled(); expect(h.navigationBusyRef.current).toBe(false);
  });
  it('opens only after the explicit untracked choice and ignores duplicate warning activation', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'permission-denied' }));
    await h.action(); const buttons = h.alert.mock.calls[0][2];
    expect(h.openURL).not.toHaveBeenCalled();
    await buttons[1].onPress(); await buttons[1].onPress();
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.prepareBackgroundTracking).toHaveBeenCalledOnce();
  });
  it('releases the warning tap lock when dismissed with Back', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'start-failed' }));
    await h.action(); h.alert.mock.calls[0][3].onDismiss();
    expect(h.navigationBusyRef.current).toBe(false); expect(h.openURL).not.toHaveBeenCalled();
  });
  it('requires explicit untracked navigation before acceptance without requesting tracking', async () => {
    const h = screen({ ...trip, trip_status: 'Assigned', origin_latitude: 14.6, origin_longitude: 121 });
    await h.action(); expect(h.prepareBackgroundTracking).not.toHaveBeenCalled(); expect(h.openURL).not.toHaveBeenCalled();
    await h.alert.mock.calls[0][2][1].onPress(); expect(h.openURL).toHaveBeenCalledOnce();
  });
  it.each(['completed', 'changed-target', 'session-ended'])('rejects %s during readiness', async kind => {
    const pending = deferred(), h = screen(trip, () => pending.promise), running = h.action();
    await flush();
    if (kind === 'completed') h.activeTripRef.current = null;
    if (kind === 'changed-target') h.activeTripRef.current = { ...trip, destination_latitude: 15 };
    if (kind === 'session-ended') h.endSession();
    pending.resolve({ ok: true }); await running;
    expect(h.openURL).not.toHaveBeenCalled(); expect(h.stop).toHaveBeenCalledOnce();
  });
  it('rejects a completed trip when the warning override is selected later', async () => {
    const h = screen(trip, async () => ({ ok: false, reason: 'permission-denied' }));
    await h.action(); h.activeTripRef.current = null;
    await h.alert.mock.calls[0][2][1].onPress(); expect(h.openURL).not.toHaveBeenCalled();
  });
  it('reports platform open failure and rolls back prepared tracking', async () => {
    const h = screen(); h.openURL.mockRejectedValue(new Error('no handler'));
    await h.action(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.alert.mock.calls[0][1]).toMatch(/Unable to open Google Maps/);
  });
  it('retains the Dispatch verification message for invalid targets', async () => {
    const h = screen({ ...trip, destination_latitude: null }); await h.action();
    expect(h.prepareBackgroundTracking).not.toHaveBeenCalled(); expect(h.openURL).not.toHaveBeenCalled();
    expect(h.alert.mock.calls[0][1]).toMatch(/Ask Dispatch to verify/);
  });
  it('keeps handoff ownership when foreground return races native preparation', async () => {
    const ready = deferred(), stopped = deferred(); let registered = false;
    const h = screen(trip, async () => { registered = true; await ready.promise; return { ok: true }; });
    h.stop.mockImplementation(async () => { await stopped.promise; registered = false; return { ok: true }; });
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('inactive'); change('active'); await flush();
    ready.resolve(); await running; stopped.resolve(); await flush();
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.alert).not.toHaveBeenCalled();
    expect(registered).toBe(true); expect(h.stop).not.toHaveBeenCalled();
  });
  it('waits for foreground cleanup already in progress before preparing Maps', async () => {
    const stopped = deferred(); let registered = true;
    const h = screen(trip, async () => { registered = true; return { ok: true }; });
    h.stop.mockImplementation(async () => { await stopped.promise; registered = false; return { ok: true }; });
    const change = attachLifecycle(h); h.context.appState.current = 'background';
    change('active'); await flush(); expect(h.stop).toHaveBeenCalledOnce();
    const running = h.action(); await flush();
    expect(h.prepareBackgroundTracking).not.toHaveBeenCalled(); expect(h.openURL).not.toHaveBeenCalled();
    stopped.resolve(); await running;
    expect(h.openURL).toHaveBeenCalledOnce(); expect(registered).toBe(true);
  });
  it('cleans up a real Maps return even if the platform open promise settles late', async () => {
    const opened = deferred(), h = screen(); h.openURL.mockImplementation(() => opened.promise);
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); await flush();
    expect(h.stop).not.toHaveBeenCalled();
    opened.resolve(); await running;
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(false);
    expect(h.context.loadTripRef.current).toHaveBeenCalledOnce();
    expect(h.stop.mock.invocationCallOrder[0]).toBeLessThan(h.context.loadTripRef.current.mock.invocationCallOrder[0]);
  });
  it.each(['stop', 'merge'])('preserves a second departure during late Maps return %s', async pendingStage => {
    const opened = deferred(), cleaned = deferred(); let registered = false;
    const h = screen(trip, async () => { registered = true; return { ok: true }; });
    const merge = vi.fn(async () => { if (pendingStage === 'merge') await cleaned.promise; }); h.context.mergeStoredKm = merge;
    h.openURL.mockImplementation(() => opened.promise);
    h.stop.mockImplementation(async () => { if (pendingStage === 'stop') await cleaned.promise; registered = false; return { ok: true }; });
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); opened.resolve(); await flush();
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.navigationBusyRef.current).toBe(true);
    change('background'); await flush();
    expect(h.prepareBackgroundTracking).toHaveBeenCalledOnce();
    cleaned.resolve(); await running; await h.context.trackingTransitionRef.current;
    expect(registered).toBe(true); expect(h.navigationBusyRef.current).toBe(false);
    expect(h.prepareBackgroundTracking).toHaveBeenLastCalledWith({ tripId: 7, leg: 'leg2', requestPermission: false });
    expect(merge).toHaveBeenCalledOnce();
    expect(merge.mock.invocationCallOrder[0]).toBeLessThan(h.prepareBackgroundTracking.mock.invocationCallOrder[1]);
    expect(h.openURL).toHaveBeenCalledOnce(); expect(h.alert).not.toHaveBeenCalled();
  });
  it.each(['foreground', 'cancelled', 'reassigned'])('rechecks %s before replaying a departure held behind owner cleanup', async changeDuringCleanup => {
    const opened = deferred(), stopped = deferred(); let registered = false;
    const h = screen(trip, async () => { registered = true; return { ok: true }; });
    h.openURL.mockImplementation(() => opened.promise);
    h.stop.mockImplementation(async () => { await stopped.promise; registered = false; return { ok: true }; });
    const change = attachLifecycle(h), running = h.action(); await flush();
    change('background'); change('active'); opened.resolve(); await flush();
    change('background');
    if (changeDuringCleanup === 'foreground') change('active');
    if (changeDuringCleanup === 'cancelled') h.activeTripRef.current = { ...trip, trip_status: 'Cancelled' };
    if (changeDuringCleanup === 'reassigned') h.activeTripRef.current = { ...trip, trip_id: 8 };
    stopped.resolve(); await running; await h.context.trackingTransitionRef.current;
    expect(registered).toBe(false); expect(h.prepareBackgroundTracking).toHaveBeenCalledOnce();
    expect(h.navigationBusyRef.current).toBe(false); expect(h.openURL).toHaveBeenCalledOnce();
  });
});

describe('Map AppState preparation fallback', () => {
  function lifecycle(prepare) {
    const start = source.indexOf('  const appState = useRef(AppState.currentState);');
    const end = source.indexOf('  const prevTripIdsRef', start);
    let change;
    const activeTripRef = { current: { ...trip } }, navigationBusyRef = { current: false };
    const stop = vi.fn().mockResolvedValue({ ok: true }), merge = vi.fn().mockResolvedValue(undefined);
    runInNewContext(source.slice(start, end), {
      useRef: current => ({ current }), useEffect: fn => fn(), activeTripRef, navigationBusyRef, navigationOperationRef: { current: null }, trackingTransitionRef: { current: Promise.resolve() },
      AppState: { currentState: 'active', addEventListener: (_, fn) => { change = fn; return { remove() {} }; } },
      isGpsTrackedTrip: value => value?.trip_status === 'En Route', legForStatus, updateLegContext: async () => {}, prepareBackgroundTracking: prepare, startBackgroundTracking: async () => {},
      stopBackgroundTracking: stop, mergeStoredKm: merge, distRef: { current: {} }, loadTripRef: { current: async () => {} },
    });
    return { change, activeTripRef, navigationBusyRef, stop, merge };
  }
  it('never requests permission from the background transition', async () => {
    const prepare = vi.fn().mockResolvedValue({ ok: true }), h = lifecycle(prepare);
    h.change('background'); await flush();
    expect(prepare).toHaveBeenCalledWith({ tripId: 7, leg: 'leg2', requestPermission: false });
  });
  it('does not start another preparation while the handoff permission flow is pending', async () => {
    const prepare = vi.fn(), h = lifecycle(prepare); h.navigationBusyRef.current = true;
    h.change('inactive'); await flush(); expect(prepare).not.toHaveBeenCalled();
  });
  it('stops a pending start after foreground return and merges only after stopping', async () => {
    const pending = deferred(), prepare = vi.fn(() => pending.promise), h = lifecycle(prepare);
    h.change('background'); await flush(); h.change('active'); await flush();
    expect(h.stop).not.toHaveBeenCalled(); expect(h.merge).not.toHaveBeenCalled();
    pending.resolve({ ok: true }); await flush();
    expect(h.stop).toHaveBeenCalledTimes(2); expect(h.merge).toHaveBeenCalledWith(expect.anything(), 7);
    expect(h.stop.mock.invocationCallOrder[1]).toBeLessThan(h.merge.mock.invocationCallOrder[0]);
  });
  it('stops if cancellation preserves the trip id while background startup is pending', async () => {
    const pending = deferred(), h = lifecycle(() => pending.promise);
    h.change('background'); await flush();
    h.activeTripRef.current = { ...trip, trip_status: 'Cancelled' };
    pending.resolve({ ok: true }); await flush(); expect(h.stop).toHaveBeenCalledOnce();
  });
});
