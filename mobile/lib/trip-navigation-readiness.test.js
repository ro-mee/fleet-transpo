import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Keep the owner, native preparation, background handler and odometer real.
const state = vi.hoisted(() => ({ effects: [], appListeners: new Set(), signal: null, task: null, running: false, storage: new Map() }));
vi.mock("react", () => ({ useEffect: effect => state.effects.push(effect) }));
vi.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: {
  currentState: "active",
  addEventListener: (_name, callback) => { state.appListeners.add(callback); return { remove: () => state.appListeners.delete(callback) }; },
} }));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 1 }, ActivityType: { AutomotiveNavigation: 1 },
  getForegroundPermissionsAsync: vi.fn(), requestForegroundPermissionsAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(), requestBackgroundPermissionsAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(), startLocationUpdatesAsync: vi.fn(), stopLocationUpdatesAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}));
vi.mock("expo-task-manager", () => ({ defineTask: (_name, handler) => { state.task = handler; } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async key => state.storage.get(key) ?? null,
  setItem: async (key, value) => { state.storage.set(key, value); },
} }));
vi.mock("./auth", () => ({ useAuth: () => ({ user: { employeeId: 10 } }) }));
vi.mock("./cargo-sync", () => ({
  captureCargoSession: () => ({ signal: state.signal.signal }),
  isCurrentCargoSession: session => session.signal === state.signal.signal && !session.signal.aborted,
}));
vi.mock("./api", () => ({ api: { post: vi.fn() }, subscribeApiEvents: () => () => {} }));
vi.mock("./trip-bubble", () => ({ hideTripBubble: vi.fn() }));

import { AppState } from "react-native";
import * as Location from "expo-location";
import { api } from "./api";
import { cancelTripNavigation, getTripLocation, getTripTrackingStatus, prepareTripNavigation, setTrackedTrip, useTripLocationOwner } from "./trip-location-owner";
import { beginNavigationHandoff } from "./navigation-handoff";
import { navigationTarget } from "./navigation-route";
import { launchExternalNavigation } from "./external-navigation";
import { createTripBubbleHandoff } from "./trip-bubble-handoff";
import { legForStatus } from "./trip-navigation-phase";

const trip = { trip_id: 7, trip_status: "Trip Started" };
const options = { tripId: 7, leg: "leg1", requestPermission: true };
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const appState = next => { AppState.currentState = next; for (const listener of state.appListeners) listener(next); };
const location = (lat, timestamp) => ({ timestamp, coords: { latitude: lat, longitude: 121, speed: 12 } });
let cleanup;
let mapCleanup;

function mapHandoff() {
  const source = readFileSync("mobile/app/(app)/(tabs)/map.js", "utf8");
  const openURL = vi.fn(), alert = vi.fn(), request = vi.fn();
  const tripBubbleRef = { current: createTripBubbleHandoff({
    show: vi.fn(async () => ({ shown: true })), hide: vi.fn(),
    availability: async () => ({ available: false, reason: "permission-denied" }), request, alert,
    storage: { getItem: async key => state.storage.get(key), setItem: async (key, value) => { state.storage.set(key, value); } },
  }) };
  const navigationBusyRef = { current: false }, appStateRef = { current: "active" };
  const context = {
    activeTripRef: { current: { ...trip, origin_latitude: 14.7, origin_longitude: 121.1 } },
    navigationBusyRef, navigationOperationRef: { current: null }, setNavigationBusy: vi.fn(), appState: appStateRef,
    tripBubbleRef, user: { employeeId: 10 },
    captureCargoSession: () => ({ signal: state.signal.signal }),
    isCurrentCargoSession: session => session.signal === state.signal.signal && !session.signal.aborted,
    navigationTarget, legForStatus, beginNavigationHandoff, launchExternalNavigation,
    prepareTripNavigation, cancelTripNavigation, isGpsTrackedTrip: () => true,
    Linking: { openURL }, AppAlert: { alert }, useCallback: fn => fn, loadTripRef: { current: vi.fn() },
  };
  const lifecycleStart = source.indexOf("  const appState = useRef(AppState.currentState);");
  const lifecycleEnd = source.indexOf("  const prevTripIdsRef", lifecycleStart);
  runInNewContext(source.slice(lifecycleStart, lifecycleEnd), {
    ...context, AppState, useRef: () => appStateRef, useEffect: effect => { mapCleanup = effect(); },
  });
  const start = source.indexOf("  const openExternalNavigation =");
  const end = source.indexOf("  const handleMapReady", start);
  const action = runInNewContext(`${source.slice(start, end)}; openExternalNavigation`, context);
  return { action, openURL, alert, request, navigationBusyRef };
}

beforeEach(async () => {
  vi.resetAllMocks();
  state.storage.clear(); state.running = false; state.signal = new AbortController();
  AppState.currentState = "active";
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.hasStartedLocationUpdatesAsync.mockImplementation(async () => state.running);
  Location.startLocationUpdatesAsync.mockImplementation(async () => { state.running = true; });
  Location.stopLocationUpdatesAsync.mockImplementation(async () => { state.running = false; });
  Location.watchPositionAsync.mockResolvedValue({ remove: vi.fn() });
  api.post.mockResolvedValue({ tracked: true });
  useTripLocationOwner(true); cleanup = state.effects.pop()(); await settle();
  setTrackedTrip(trip); await settle();
});

afterEach(async () => { mapCleanup?.(); mapCleanup = null; cleanup?.(); state.signal.abort(); await settle(); });

describe("navigation readiness through the real single owner and native boundary", () => {
  it.each([true, false])("revalidates the real native task stopped by shortcut Settings return (can restart: %s)", async canRestart => {
    const h = mapHandoff();
    let finishSettings;
    h.request.mockImplementation(() => new Promise(resolve => { finishSettings = resolve; }));
    h.openURL.mockImplementation(async () => {
      // Native readiness is checked at the actual Maps boundary, after Settings.
      expect(state.running).toBe(canRestart);
    });
    const running = h.action(); await settle();
    expect(state.running).toBe(true);
    h.alert.mock.calls[0][2][1].onPress();
    appState("background"); await settle(); appState("active"); await settle();
    expect(state.running).toBe(false);
    if (!canRestart) Location.startLocationUpdatesAsync.mockRejectedValue(new Error("OS restart refused"));
    finishSettings({ granted: true }); await running;
    if (canRestart) {
      expect(state.running).toBe(true);
      expect(h.openURL).toHaveBeenCalledOnce();
      expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
      expect(h.navigationBusyRef.current).toBe(false);
    } else {
      expect(h.openURL).not.toHaveBeenCalled();
      expect(h.navigationBusyRef.current).toBe(true);
      const [title, , buttons] = h.alert.mock.calls[1];
      expect(title).toMatch(/tracking unavailable/i);
      expect(getTripTrackingStatus()).toMatchObject({ state: "paused", reason: "start-failed" });
      await buttons[1].onPress(); await buttons[1].onPress();
      expect(h.openURL).toHaveBeenCalledOnce();
      expect(state.running).toBe(false);
      expect(h.navigationBusyRef.current).toBe(false);
    }
  });
  it("refuses foreground-only permission and never reports native readiness", async () => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    expect(await prepareTripNavigation(options)).toEqual({ ok: false, reason: "permission-denied" });
    expect(getTripTrackingStatus()).toEqual({ tripId: 7, leg: "leg1", state: "paused", reason: "permission-denied" });
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
  });

  it("reports an actual native start exception without a false ready result", async () => {
    Location.startLocationUpdatesAsync.mockRejectedValue(new Error("missing native service"));
    expect(await prepareTripNavigation(options)).toEqual({ ok: false, reason: "start-failed" });
    expect(getTripTrackingStatus().state).toBe("paused");
    expect(state.running).toBe(false);
  });

  it("removes a prepared native task when a foreground handoff is abandoned", async () => {
    expect(await prepareTripNavigation(options)).toEqual({ ok: true });
    expect(state.running).toBe(true);
    expect(await cancelTripNavigation(options)).toEqual({ ok: true });
    expect(state.running).toBe(false);
    expect(getTripTrackingStatus().state).toBe("idle");
    expect(Location.watchPositionAsync).toHaveBeenCalledOnce();
  });

  it("suppresses prepared-task foreground delivery and drains background mileage once on return", async () => {
    expect(await prepareTripNavigation(options)).toEqual({ ok: true });
    const sample = Location.watchPositionAsync.mock.calls[0][1];
    sample(location(14.6, 1000));
    await state.task({ data: { locations: [location(14.6005, 4000)] } });
    expect(api.post).not.toHaveBeenCalled();
    expect(getTripLocation()).toEqual(location(14.6, 1000));
    appState("background"); await settle();
    sample(location(14.7, 4000));
    expect(getTripLocation()).toEqual(location(14.6, 1000));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledOnce();
    await state.task({ data: { locations: [location(14.6005, 4000), location(14.601, 7000)] } });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(state.storage.get("fleetops_bg_tracking")).km1).toBeCloseTo(0.0556, 3);
    appState("active"); await settle();
    expect(state.running).toBe(false);
    expect(JSON.parse(state.storage.get("fleetops_bg_tracking")).km1).toBe(0);
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
    appState("active"); await settle();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
  });

  it("does not register a task after the session expires during background permission checking", async () => {
    let resolvePermission;
    Location.getBackgroundPermissionsAsync.mockImplementation(() => new Promise(resolve => { resolvePermission = resolve; }));
    const pending = prepareTripNavigation(options); await settle();
    state.signal.abort(); resolvePermission({ status: "granted" });
    expect(await pending).toEqual({ ok: false, reason: "stale-trip" }); await settle();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(getTripTrackingStatus()).toEqual({ tripId: null, leg: null, state: "idle", reason: null });
    expect(JSON.parse(state.storage.get("fleetops_bg_tracking"))).toMatchObject({ tripId: null, leg: null });
  });

  it("leaves later permission denial visible without prompting after ordinary backgrounding", async () => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    appState("background"); await settle();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(getTripTrackingStatus()).toMatchObject({ state: "paused", reason: "permission-denied" });
    appState("active"); await settle();
    expect(getTripTrackingStatus()).toMatchObject({ state: "paused", reason: "permission-denied" });
  });
});
