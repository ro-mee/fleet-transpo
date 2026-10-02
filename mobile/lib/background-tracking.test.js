import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    async setItem(key, value) {
      storage.set(key, value);
    },
    async removeItem(key) {
      storage.delete(key);
    },
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-location", () => ({
  ActivityType: { AutomotiveNavigation: 1 },
  Accuracy: { Balanced: 1 },
  requestBackgroundPermissionsAsync: vi.fn(),
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

describe("background odometer anchor persistence", () => {
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
