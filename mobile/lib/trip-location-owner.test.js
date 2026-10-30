import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ effects: [], appListeners: new Set(), apiListeners: new Set(), actor: 10, signal: null, storedKm: 0 }));
vi.mock("react", () => ({ useEffect: (effect) => state.effects.push(effect) }));
vi.mock("react-native", () => ({ AppState: {
  currentState: "active",
  addEventListener: (_name, listener) => { state.appListeners.add(listener); return { remove: () => state.appListeners.delete(listener) }; },
} }));
vi.mock("expo-location", () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: vi.fn(), watchPositionAsync: vi.fn() }));
vi.mock("./auth", () => ({ useAuth: () => ({ user: { employeeId: state.actor } }) }));
vi.mock("./cargo-sync", () => ({
  captureCargoSession: (actor) => actor === state.actor && actor != null ? { actorId: actor, signal: state.signal.signal } : null,
  isCurrentCargoSession: (session) => session?.actorId === state.actor && session?.signal === state.signal.signal && !session.signal.aborted,
}));
vi.mock("./api", () => ({ subscribeApiEvents: (listener) => { state.apiListeners.add(listener); return () => state.apiListeners.delete(listener); } }));
vi.mock("./background-tracking", () => ({
  prepareBackgroundTracking: vi.fn(), startBackgroundTracking: vi.fn(), stopBackgroundTracking: vi.fn(), updateLegContext: vi.fn(), mergeStoredKm: vi.fn(),
  legForStatus: (status) => ["Driver Accepted", "Trip Started", "At Pickup"].includes(status) ? "leg1" : "leg2",
}));

import { AppState } from "react-native";
import * as Location from "expo-location";
import { mergeStoredKm, prepareBackgroundTracking, startBackgroundTracking, stopBackgroundTracking, updateLegContext } from "./background-tracking";
import { cancelTripNavigation, captureTrackedTripRead, getTripLocation, getTripTrackingStatus, prepareTripNavigation, retryTripLocation, setTrackedTrip, subscribeTripLocation, subscribeTripTrackingStatus, useTripLocationOwner } from "./trip-location-owner";

const trip = { trip_id: 7, trip_status: "Trip Started" };
const cleanups = [];
const settle = async () => { for (let index = 0; index < 60; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const fix = (latitude, at = 1000) => ({ timestamp: at, coords: { latitude, longitude: 121, speed: 12, heading: 0, accuracy: 12 } });
const appState = (next) => { AppState.currentState = next; for (const listener of state.appListeners) listener(next); };
const complete = (tripId = 7) => { for (const listener of state.apiListeners) listener({ type: "trip-completed", tripId }); };
function MountOwner(enabled = true) {
  useTripLocationOwner(enabled);
  const cleanup = state.effects.pop()();
  if (cleanup) cleanups.push(cleanup);
  return settle();
}
async function track(status = "Trip Started") {
  setTrackedTrip({ ...trip, trip_status: status });
  await settle();
  return Location.watchPositionAsync.mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.resetAllMocks();
  state.actor = 10;
  state.signal = new AbortController();
  state.storedKm = 0;
  AppState.currentState = "active";
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.watchPositionAsync.mockResolvedValue({ remove: vi.fn() });
  prepareBackgroundTracking.mockResolvedValue({ ok: true });
  startBackgroundTracking.mockResolvedValue({ ok: true });
  stopBackgroundTracking.mockResolvedValue(undefined);
  updateLegContext.mockResolvedValue(undefined);
  mergeStoredKm.mockImplementation(async (ref) => { ref.current.leg1 += state.storedKm; state.storedKm = 0; });
});

describe("single-owner navigation readiness", () => {
  const options = { tripId: 7, leg: "leg1", requestPermission: true };

  it.each(["permission-denied", "start-failed", "unsupported"])("does not report ready after %s", async reason => {
    await MountOwner(); await track();
    prepareBackgroundTracking.mockResolvedValueOnce({ ok: false, reason });
    expect(await prepareTripNavigation(options)).toEqual({ ok: false, reason });
    expect(getTripTrackingStatus()).toEqual({ tripId: 7, leg: "leg1", state: "paused", reason });
  });

  it("prepares through the native queue without replacing the foreground collector", async () => {
    await MountOwner(); const sample = await track();
    sample(fix(14.6));
    const remove = (await Location.watchPositionAsync.mock.results[0].value).remove;
    const pending = deferred(); prepareBackgroundTracking.mockReturnValueOnce(pending.promise);
    const ready = prepareTripNavigation(options); await settle();
    expect(getTripTrackingStatus().state).toBe("preparing");
    sample(fix(14.6005, 4000));
    expect(getTripLocation()).toEqual(fix(14.6005, 4000));
    pending.resolve({ ok: true });
    expect(await ready).toEqual({ ok: true });
    expect(prepareBackgroundTracking).toHaveBeenCalledWith({ ...options, isCurrent: expect.any(Function) });
    expect(remove).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).toHaveBeenCalledOnce();
    expect(getTripTrackingStatus()).toEqual({ tripId: 7, leg: "leg1", state: "ready", reason: null });
  });

  it.each(["trip", "leg", "completion", "session", "visibility"])("invalidates late readiness after %s changes", async change => {
    await MountOwner(); await track();
    const pending = deferred(); prepareBackgroundTracking.mockReturnValueOnce(pending.promise);
    const ready = prepareTripNavigation(options); await settle();
    if (change === "trip") setTrackedTrip({ trip_id: 8, trip_status: "Trip Started" });
    if (change === "leg") setTrackedTrip({ ...trip, trip_status: "Passenger Onboard" });
    if (change === "completion") complete();
    if (change === "session") state.signal.abort();
    if (change === "visibility") { appState("background"); appState("active"); }
    pending.resolve({ ok: true });
    expect(await ready).toEqual({ ok: false, reason: "stale-trip" });
    await settle();
    expect(getTripTrackingStatus().state).not.toBe("ready");
    expect(stopBackgroundTracking.mock.invocationCallOrder.at(-1)).toBeGreaterThan(prepareBackgroundTracking.mock.invocationCallOrder[0]);
  });

  it.each([{ tripId: 8, leg: "leg1" }, { tripId: 7, leg: "leg2" }])("refuses a mismatching request before native work: %s", async request => {
    await MountOwner(); await track();
    expect(await prepareTripNavigation(request)).toEqual({ ok: false, reason: "stale-trip" });
    expect(prepareBackgroundTracking).not.toHaveBeenCalled();
  });

  it("refuses preparation while disabled or backgrounded", async () => {
    expect(await prepareTripNavigation(options)).toEqual({ ok: false, reason: "stale-trip" });
    await MountOwner(); await track(); appState("background"); await settle();
    expect(await prepareTripNavigation(options)).toEqual({ ok: false, reason: "stale-trip" });
    expect(prepareBackgroundTracking).not.toHaveBeenCalled();
  });

  it("publishes an automatic start failure and retains it for the returning Map", async () => {
    await MountOwner(); await track();
    const listener = vi.fn(); const unsubscribe = subscribeTripTrackingStatus(listener);
    startBackgroundTracking.mockResolvedValueOnce({ ok: false, reason: "start-failed" });
    appState("background"); await settle();
    expect(startBackgroundTracking).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(listener).toHaveBeenLastCalledWith({ tripId: 7, leg: "leg1", state: "paused", reason: "start-failed" });
    appState("active"); await settle();
    expect(getTripTrackingStatus().state).toBe("paused");
    expect(await prepareTripNavigation(options)).toEqual({ ok: true });
    expect(getTripTrackingStatus().state).toBe("ready");
    unsubscribe(); const calls = listener.mock.calls.length;
    complete(); await settle();
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(getTripTrackingStatus()).toEqual({ tripId: null, leg: null, state: "idle", reason: null });
  });

  it("turns rejected background startup into visible paused status and recovers the queue", async () => {
    await MountOwner(); await track();
    startBackgroundTracking.mockRejectedValueOnce(new Error("native unavailable"));
    appState("background"); await settle();
    expect(getTripTrackingStatus()).toMatchObject({ state: "paused", reason: "start-failed" });
    appState("active"); await settle();
    expect(await prepareTripNavigation(options)).toEqual({ ok: true });
  });

  it("retains a failed background start that settles after returning to the Map", async () => {
    await MountOwner(); await track();
    const pending = deferred(); startBackgroundTracking.mockReturnValueOnce(pending.promise);
    appState("background"); await settle();
    appState("active");
    pending.resolve({ ok: false, reason: "start-failed" }); await settle();
    expect(getTripTrackingStatus()).toEqual({ tripId: 7, leg: "leg1", state: "paused", reason: "start-failed" });
  });

  it("cancels a prepared native task after a failed handoff without replacing foreground collection", async () => {
    await MountOwner(); await track();
    await prepareTripNavigation(options);
    const stopped = stopBackgroundTracking.mock.calls.length;
    expect(await cancelTripNavigation(options)).toEqual({ ok: true });
    expect(stopBackgroundTracking).toHaveBeenCalledTimes(stopped + 1);
    expect(getTripTrackingStatus().state).toBe("idle");
    expect(Location.watchPositionAsync).toHaveBeenCalledOnce();
  });

  it("never cancels another trip or the lifecycle-owned background collector", async () => {
    await MountOwner(); await track();
    await prepareTripNavigation(options);
    expect(await cancelTripNavigation({ tripId: 8, leg: "leg1" })).toEqual({ ok: false, reason: "stale-trip" });
    appState("background"); await settle();
    const stopped = stopBackgroundTracking.mock.calls.length;
    expect(await cancelTripNavigation(options)).toEqual({ ok: false, reason: "stale-trip" });
    expect(stopBackgroundTracking).toHaveBeenCalledTimes(stopped);
    expect(getTripTrackingStatus().state).toBe("ready");
  });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  state.signal.abort();
  await settle();
  state.effects.length = 0;
});

describe("app-owned trip location and mileage", () => {
  it("keeps the high-frequency accumulator running when the Map subscriber leaves", async () => {
    await MountOwner();
    const listener = vi.fn();
    const unsubscribe = subscribeTripLocation(listener);
    const sample = await track();
    expect(Location.watchPositionAsync.mock.calls[0]?.[0]).toEqual({ accuracy: 4, timeInterval: 1500, distanceInterval: 3 });
    sample(fix(14.6));
    const deliveries = listener.mock.calls.length;
    unsubscribe();
    sample(fix(14.6005, 4000));
    expect(getTripLocation()).toEqual(fix(14.6005, 4000));
    expect(listener).toHaveBeenCalledTimes(deliveries);
    appState("background"); await settle();
    appState("active"); await settle();
    const accumulator = mergeStoredKm.mock.calls.at(-1)[0].current;
    expect(accumulator.leg1).toBeCloseTo(0.0556, 3);
  });

  it("ignores pending, completed and idle trips and updates same-trip context only on a status change", async () => {
    await MountOwner();
    for (const trip_status of ["Assigned", "Dispatched", "Completed"]) setTrackedTrip({ ...trip, trip_status });
    await settle();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    const sample = await track("Driver Accepted");
    sample(fix(14.6)); sample(fix(14.6005, 4000));
    const starts = Location.watchPositionAsync.mock.calls.length;
    setTrackedTrip({ ...trip, trip_status: "Driver Accepted" }); await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(starts);
    await track("Passenger Onboard");
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: 7, leg: "leg2" });
    expect(mergeStoredKm.mock.calls.at(-1)[0].current.leg1).toBeGreaterThan(0);
  });

  it("removes a delayed foreground subscription and ignores its callbacks after disable", async () => {
    const pending = deferred();
    const remove = vi.fn();
    Location.watchPositionAsync.mockReturnValueOnce(pending.promise);
    await MountOwner();
    const sample = await track();
    await MountOwner(false);
    pending.resolve({ remove }); await settle();
    sample(fix(14.6));
    expect(remove).toHaveBeenCalledOnce();
    expect(getTripLocation()).toBeNull();
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: null, leg: null });
  });

  it("stops foreground callbacks before background ownership and merges stored mileage once on return", async () => {
    await MountOwner();
    const sample = await track();
    sample(fix(14.6));
    appState("background"); await settle();
    sample(fix(14.7, 4000));
    expect(getTripLocation()).toEqual(fix(14.6));
    expect(startBackgroundTracking).toHaveBeenCalledOnce();
    state.storedKm = 2.5;
    appState("active"); await settle();
    const ref = mergeStoredKm.mock.calls.at(-1)[0];
    expect(ref.current.leg1).toBe(2.5);
    const merges = mergeStoredKm.mock.calls.length;
    appState("active"); await settle();
    expect(mergeStoredKm).toHaveBeenCalledTimes(merges);
    expect(ref.current.prev).toBeNull();
    expect(ref.current.pending).toBeNull();
  });

  it("prevents completion during context save from starting background tracking or reviving through a late poll", async () => {
    await MountOwner(); await track();
    const pending = deferred();
    updateLegContext.mockReturnValueOnce(pending.promise);
    appState("background"); await settle();
    complete();
    pending.resolve(); await settle();
    setTrackedTrip(trip); await settle();
    expect(startBackgroundTracking).not.toHaveBeenCalled();
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: null, leg: null });
    expect(getTripLocation()).toBeNull();
  });

  it("stops an OS background start that finishes after completion", async () => {
    await MountOwner(); await track();
    const pending = deferred();
    startBackgroundTracking.mockReturnValueOnce(pending.promise);
    appState("background"); await settle();
    complete();
    pending.resolve(); await settle();
    expect(stopBackgroundTracking.mock.invocationCallOrder.at(-1)).toBeGreaterThan(startBackgroundTracking.mock.invocationCallOrder[0]);
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: null, leg: null });
  });

  it("waits for a pending background start to stop before resuming the foreground stream", async () => {
    await MountOwner(); await track();
    const pending = deferred();
    startBackgroundTracking.mockReturnValueOnce(pending.promise);
    appState("background"); await settle();
    appState("active"); await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledOnce();
    pending.resolve(); await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
    expect(Location.watchPositionAsync.mock.invocationCallOrder.at(-1)).toBeGreaterThan(stopBackgroundTracking.mock.invocationCallOrder.at(-1));
  });

  it("clears the trip immediately when the signed-in actor expires, even before React cleanup", async () => {
    await MountOwner();
    const sample = await track(); sample(fix(14.6));
    state.signal.abort();
    sample(fix(14.6005, 4000)); await settle();
    expect(getTripLocation()).toBeNull();
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: null, leg: null });
    expect(stopBackgroundTracking).toHaveBeenCalled();
  });

  it("ignores another trip's completion and resets mileage for a genuinely new trip", async () => {
    await MountOwner(); const sample = await track();
    sample(fix(14.6)); sample(fix(14.6005, 4000));
    complete(999); await settle();
    expect(getTripLocation()).toEqual(fix(14.6005, 4000));
    setTrackedTrip({ trip_id: 8, trip_status: "Trip Started" }); await settle();
    expect(getTripLocation()).toBeNull();
    expect(mergeStoredKm.mock.calls.at(-1)[0].current.leg1).toBe(0);
  });

  it("signals provider failure without banking the unobserved interval, then recovers on a new fix", async () => {
    await MountOwner(); const sample = await track();
    const unavailable = Location.watchPositionAsync.mock.calls[0]?.[2];
    expect(typeof unavailable).toBe("function");
    sample(fix(14.6));
    const listener = vi.fn(); const unsubscribe = subscribeTripLocation(listener);
    unavailable("Location services disabled");
    expect(getTripLocation()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
    sample(fix(14.6005, 4000));
    expect(getTripLocation()).toEqual(fix(14.6005, 4000));
    appState("background"); await settle(); appState("active"); await settle();
    expect(mergeStoredKm.mock.calls.at(-1)[0].current.leg1).toBe(0);
    unsubscribe();
  });

  it.each(["denied", "permission-error", "watch-error"])("signals unavailable location for initialization failure: %s", async (failure) => {
    await MountOwner();
    if (failure === "denied") Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    if (failure === "permission-error") Location.requestForegroundPermissionsAsync.mockRejectedValueOnce(new Error("provider off"));
    if (failure === "watch-error") Location.watchPositionAsync.mockRejectedValueOnce(new Error("watch failed"));
    const listener = vi.fn(); const unsubscribe = subscribeTripLocation(listener);
    await track();
    // Trip change clears the previous fix; the later provider refusal is a separate signal.
    expect(listener.mock.calls.map(([location]) => location)).toEqual([null, null]);
    expect(getTripLocation()).toBeNull();
    unsubscribe();
  });

  it.each([undefined, null, NaN])("does not publish an un-timed sample as a current fix: %s", async (timestamp) => {
    await MountOwner(); const sample = await track();
    sample(fix(14.6));
    sample({ ...fix(14.6005), timestamp });
    expect(getTripLocation()).toBeNull();
  });

  it("stops any persisted native tracking when disabled before a trip has been loaded", async () => {
    await MountOwner(false);
    expect(stopBackgroundTracking).toHaveBeenCalled();
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: null, leg: null });
  });

  it("retries the native stream after provider failure and fences callbacks from the replaced watcher", async () => {
    await MountOwner(); const previous = await track();
    previous(fix(14.6));
    Location.watchPositionAsync.mock.calls[0][2]("Location services disabled");
    retryTripLocation(); await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
    previous(fix(14.6005, 4000));
    expect(getTripLocation()).toBeNull();
    const current = Location.watchPositionAsync.mock.calls[1][1];
    current(fix(14.601, 7000));
    expect(getTripLocation()).toEqual(fix(14.601, 7000));
  });

  it("ignores a delayed leg-one read after another screen confirms the newer leg", async () => {
    await MountOwner(); await track();
    const pending = captureTrackedTripRead();
    setTrackedTrip({ ...trip, trip_status: "Passenger Onboard" }); await settle();
    setTrackedTrip(trip, pending); await settle();
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: 7, leg: "leg2" });
  });

  it("ignores a delayed empty read after a newer trip has been selected", async () => {
    await MountOwner(); await track();
    const pending = captureTrackedTripRead();
    setTrackedTrip({ trip_id: 8, trip_status: "Trip Started" }); await settle();
    const sample = Location.watchPositionAsync.mock.calls.at(-1)[1];
    sample(fix(14.6));
    setTrackedTrip(null, pending); await settle();
    expect(getTripLocation()).toEqual(fix(14.6));
    expect(updateLegContext).toHaveBeenLastCalledWith({ tripId: 8, leg: "leg1" });
  });

  it("rejects a read captured without an owner after an owner becomes enabled", async () => {
    const pending = captureTrackedTripRead();
    await MountOwner();
    expect(setTrackedTrip(trip, pending)).toBe(false);
    await settle();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('allows current assignment reads to render while location tracking stays disabled', async () => {
    await MountOwner(false);
    const read = captureTrackedTripRead();
    expect(setTrackedTrip(trip, read)).toBe(true);
    await settle();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(getTripLocation()).toBeNull();
  });

  it("invalidates an initial read when completion arrives before that read resolves", async () => {
    await MountOwner();
    const pending = captureTrackedTripRead();
    complete(7);
    expect(setTrackedTrip(trip, pending)).toBe(false);
    await settle();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("rejects the previous actor's read after location ownership is replaced", async () => {
    await MountOwner(); await track();
    const pending = captureTrackedTripRead();
    state.signal.abort();
    state.actor = 24; state.signal = new AbortController();
    await MountOwner();
    expect(setTrackedTrip(trip, pending)).toBe(false);
    await settle();
    expect(getTripLocation()).toBeNull();
    expect(Location.watchPositionAsync).toHaveBeenCalledOnce();
  });
});
