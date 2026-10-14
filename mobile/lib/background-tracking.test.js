import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import * as Location from "expo-location";

const mocks = vi.hoisted(() => {
  const storage = new Map();
  return {
    storage,
    taskName: null,
    taskHandler: null,
    defineTask(name, handler) {
      this.taskName = name;
      this.taskHandler = handler;
    },
    async getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem: vi.fn(async (key, value) => {
      storage.set(key, value);
    }),
    async removeItem(key) {
      storage.delete(key);
    },
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-location", () => ({
  ActivityType: { AutomotiveNavigation: 1 },
  Accuracy: { Balanced: 1 },
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
}));
vi.mock("expo-task-manager", () => ({
  defineTask: (name, handler) => mocks.defineTask(name, handler),
  isTaskDefined: () => Boolean(mocks.taskHandler),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key) => mocks.getItem(key),
    setItem: (key, value) => mocks.setItem(key, value),
    removeItem: (key) => mocks.removeItem(key),
  },
}));
vi.mock("./api", () => ({ api: { post: vi.fn(async () => ({ ok: true })) } }));

const STORAGE_KEY = "fleetops_bg_tracking";
let backgroundTracking;

beforeAll(async () => {
  backgroundTracking = await import("./background-tracking");
});

beforeEach(() => {
  mocks.storage.clear();
  vi.resetAllMocks();
  mocks.setItem.mockImplementation(async (key, value) => { mocks.storage.set(key, value); });
  Platform.OS = "android";
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  Location.startLocationUpdatesAsync.mockResolvedValue(undefined);
  Location.stopLocationUpdatesAsync.mockResolvedValue(undefined);
});

async function saveContext(context) {
  await mocks.setItem(STORAGE_KEY, JSON.stringify(context));
}

async function loadContext() {
  return JSON.parse(await mocks.getItem(STORAGE_KEY));
}

function location(lat, lng, timestamp, speed = 12) {
  return { timestamp, coords: { latitude: lat, longitude: lng, speed } };
}

describe("background tracking readiness", () => {
  const context = { tripId: "trip-1", leg: "leg2" };

  it("returns ready for a running task without starting it twice", async () => {
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    expect(await backgroundTracking.prepareBackgroundTracking(context)).toEqual({ ok: true });
    expect(Location.hasStartedLocationUpdatesAsync).toHaveBeenCalledWith("fleetops-background-location");
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("persists the trip and leg before starting with the established service options", async () => {
    Location.startLocationUpdatesAsync.mockImplementation(async () => {
      expect(await loadContext()).toMatchObject({ ...context, prev: null, pending: null });
    });

    expect(await backgroundTracking.prepareBackgroundTracking(context)).toEqual({ ok: true });
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith("fleetops-background-location", {
      accuracy: 1,
      distanceInterval: 10,
      timeInterval: 30000,
      activityType: 1,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "FleetOps tracking active",
        notificationBody: "Sharing your live location with dispatch",
        notificationColor: "#0f766e",
      },
    });
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([null, { tripId: "previous-trip", leg: "leg1", km1: 2, km2: 3 }])(
    "refuses readiness when context cannot be saved over %s", async (previous) => {
      if (previous) await saveContext(previous);
      mocks.setItem.mockRejectedValueOnce(new Error("Storage write failed"));

      expect(await backgroundTracking.prepareBackgroundTracking(context)).toEqual({ ok: false, reason: "start-failed" });
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(Location.hasStartedLocationUpdatesAsync).not.toHaveBeenCalled();
      expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
      expect(await loadContext()).toEqual(previous);
    }
  );

  it("propagates context write failure without poisoning later serialized writes or losing same-trip totals", async () => {
    await saveContext({ ...context, km1: 2, km2: 3 });
    mocks.setItem.mockRejectedValueOnce(new Error("Storage write failed"));

    await expect(backgroundTracking.updateLegContext(context)).rejects.toThrow("Storage write failed");
    expect(await backgroundTracking.prepareBackgroundTracking(context)).toEqual({ ok: true });
    expect(await loadContext()).toMatchObject({ ...context, km1: 2, km2: 3 });
  });

  it.each([undefined, false])("never prompts without permission request opt-in (%s)", async (requestPermission) => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission })).toEqual({
      ok: false, reason: "permission-denied",
    });
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("starts after an explicitly requested permission is granted", async () => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "undetermined" });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission: true })).toEqual({ ok: true });
    expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledOnce();
  });

  it("obtains foreground permission before checking and requesting background access", async () => {
    const calls = [];
    Location.getForegroundPermissionsAsync.mockImplementation(async () => { calls.push("get-foreground"); return { status: "undetermined" }; });
    Location.requestForegroundPermissionsAsync.mockImplementation(async () => { calls.push("request-foreground"); return { status: "granted" }; });
    Location.getBackgroundPermissionsAsync.mockImplementation(async () => { calls.push("get-background"); return { status: "undetermined" }; });
    Location.requestBackgroundPermissionsAsync.mockImplementation(async () => { calls.push("request-background"); return { status: "granted" }; });
    Location.startLocationUpdatesAsync.mockImplementation(async () => { calls.push("start-native"); });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission: true })).toEqual({ ok: true });
    expect(calls).toEqual(["get-foreground", "request-foreground", "get-background", "request-background", "start-native"]);
  });

  it.each([undefined, false])("never prompts or checks background access when foreground permission is absent without opt-in (%s)", async (requestPermission) => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined" });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission })).toEqual({
      ok: false, reason: "permission-denied",
    });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("stops before background access when the foreground permission prompt is refused", async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission: true })).toEqual({
      ok: false, reason: "permission-denied",
    });
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(Location.getBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("reports a refused permission without attempting a native start", async () => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission: true })).toEqual({
      ok: false, reason: "permission-denied",
    });
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it.each(["getForegroundPermissionsAsync", "requestForegroundPermissionsAsync", "getBackgroundPermissionsAsync", "requestBackgroundPermissionsAsync", "hasStartedLocationUpdatesAsync", "startLocationUpdatesAsync"])(
    "reports native failure from %s", async (method) => {
      if (method === "requestForegroundPermissionsAsync") {
        Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined" });
      }
      if (method === "requestBackgroundPermissionsAsync") {
        Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "undetermined" });
      }
      Location[method].mockRejectedValue(new Error("Native location unavailable"));

      expect(await backgroundTracking.prepareBackgroundTracking({ ...context, requestPermission: true })).toEqual({
        ok: false, reason: "start-failed",
      });
    }
  );

  it("reports web as unsupported without native calls or stored context", async () => {
    Platform.OS = "web";

    expect(await backgroundTracking.prepareBackgroundTracking(context)).toEqual({ ok: false, reason: "unsupported" });
    expect(Location.getBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(await loadContext()).toBeNull();
  });

  it("keeps the existing AppState starter compatible with stored context", async () => {
    await saveContext({ ...context, km1: 2, km2: 3 });

    expect(await backgroundTracking.startBackgroundTracking()).toEqual({ ok: true });
    expect(await loadContext()).toEqual({ ...context, km1: 2, km2: 3 });
  });
});

describe("background tracking cleanup result", () => {
  it("returns success after stopping the running task", async () => {
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    expect(await backgroundTracking.stopBackgroundTracking()).toEqual({ ok: true });
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith("fleetops-background-location");
  });

  it("returns success for an absent task without calling native stop", async () => {
    expect(await backgroundTracking.stopBackgroundTracking()).toEqual({ ok: true });
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it.each(["hasStartedLocationUpdatesAsync", "stopLocationUpdatesAsync"])("reports native cleanup failure from %s", async (method) => {
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    Location[method].mockRejectedValue(new Error("Native cleanup unavailable"));

    expect(await backgroundTracking.stopBackgroundTracking()).toEqual({ ok: false, reason: "stop-failed" });
  });

  it("returns success on web without native cleanup", async () => {
    Platform.OS = "web";

    expect(await backgroundTracking.stopBackgroundTracking()).toEqual({ ok: true });
    expect(Location.hasStartedLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe("background tracking status compatibility", () => {
  it.each([["Trip Started", "leg1"], ["At Pickup", "leg1"], ["En Route", "leg2"], ["In Progress", "leg2"], ["Completed", null], ["Cancelled", null], ["Unexpected Status", null]])(
    "maps %s to %s through the existing export", (status, leg) => {
      expect(backgroundTracking.legForStatus(status)).toBe(leg);
    }
  );
});

describe("background odometer anchor persistence", () => {
  it("keeps the existing foreground distance merge best-effort when its cleanup write fails", async () => {
    const stored = { tripId: "trip-1", leg: "leg1", km1: 2, km2: 3 };
    await saveContext(stored);
    mocks.setItem.mockRejectedValueOnce(new Error("Storage write failed"));
    const distRef = { current: { leg1: 1, leg2: 4 } };

    await expect(backgroundTracking.mergeStoredKm(distRef, "trip-1")).resolves.toBeUndefined();
    expect(distRef.current).toEqual({ leg1: 3, leg2: 7 });
    expect(await loadContext()).toEqual(stored);
  });

  it("persists gap recovery candidates and keeps rejected teleports off the anchor", async () => {
    expect(mocks.taskName).toBe("fleetops-background-location");
    await saveContext({
      tripId: "trip-1",
      leg: "leg1",
      km1: 2.5,
      km2: 0,
      prev: { lat: 14.6, lng: 121.0, atMs: 1000 },
      // Legacy contexts did not have this property and remain valid.
    });

    const staleAt = 1000 + 5 * 60 * 1000 + 1;
    await mocks.taskHandler({ data: { locations: [location(14.61, 121.0, staleAt)] } });
    let ctx = await loadContext();
    expect(ctx.km1).toBe(2.5);
    expect(ctx.prev).toBeNull();
    expect(ctx.pending).toEqual({ lat: 14.61, lng: 121.0, atMs: staleAt });

    const confirmedAt = staleAt + 3000;
    await mocks.taskHandler({ data: { locations: [location(14.61, 121.0, confirmedAt, 0)] } });
    ctx = await loadContext();
    expect(ctx.prev).toEqual({ lat: 14.61, lng: 121.0, atMs: confirmedAt });
    expect(ctx.pending).toBeNull();
    expect(ctx.km1).toBe(2.5);

    const teleportAt = confirmedAt + 3000;
    await mocks.taskHandler({ data: { locations: [location(14.9, 121.4, teleportAt)] } });
    ctx = await loadContext();
    expect(ctx.prev).toEqual({ lat: 14.61, lng: 121.0, atMs: confirmedAt });
    expect(ctx.km1).toBe(2.5);

    const nextAt = teleportAt + 3000;
    await mocks.taskHandler({ data: { locations: [location(14.6105, 121.0, nextAt)] } });
    ctx = await loadContext();
    expect(ctx.km1).toBeGreaterThan(2.5);
    expect(ctx.prev).toEqual({ lat: 14.6105, lng: 121.0, atMs: nextAt });
  });

  it("clears recovery state at leg and foreground merge boundaries", async () => {
    await saveContext({
      tripId: "trip-1",
      leg: "leg1",
      km1: 1,
      km2: 0,
      prev: { lat: 14.6, lng: 121, atMs: 1000 },
      pending: { lat: 14.61, lng: 121, atMs: 2000 },
    });

    await backgroundTracking.updateLegContext({ tripId: "trip-1", leg: "leg2" });
    let ctx = await loadContext();
    expect(ctx.prev).toBeNull();
    expect(ctx.pending).toBeNull();
    expect(ctx.km1).toBe(1);

    const distRef = { current: { leg1: 0, leg2: 0 } };
    await backgroundTracking.mergeStoredKm(distRef, "trip-1");
    ctx = await loadContext();
    expect(distRef.current).toEqual({ leg1: 1, leg2: 0 });
    expect(ctx.prev).toBeNull();
    expect(ctx.pending).toBeNull();
    expect(ctx.km1).toBe(0);
  });
});
