/**
 * Offline Read Mode cache tests (offline-cache.js).
 *
 * AsyncStorage is mocked with an in-memory Map; what is real: namespacing,
 * entry shape, fail-open reads, per-driver clear (static + dynamic trip:
 * keys), and the badge age formatter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const mem = new Map();
  return {
    default: {
      getItem: vi.fn(async (k) => (mem.has(k) ? mem.get(k) : null)),
      setItem: vi.fn(async (k, v) => {
        mem.set(k, v);
      }),
      multiRemove: vi.fn(async (keys) => {
        (keys || []).forEach((k) => mem.delete(k));
      }),
      getAllKeys: vi.fn(async () => [...mem.keys()]),
      __clear: () => mem.clear(),
      __keys: () => [...mem.keys()],
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CACHE_KEYS,
  tripCacheKey,
  resolveDriverId,
  getCached,
  setCached,
  clearOfflineCache,
  formatLastSynced,
} from "./offline-cache";

const store = AsyncStorage;

beforeEach(() => {
  store.__clear();
  vi.clearAllMocks();
});

describe("resolveDriverId", () => {
  it("resolves the exact camelCase login-response shape signIn stores", () => {
    // POST /api/mobile/auth/login returns { driverId, employeeId, email,
    // firstName, ... } and auth.js signIn stores it verbatim. A snake_case-
    // only resolver returned null here — which silently disabled every cache
    // read/write on real devices. This is the regression pin for that bug.
    const driver = {
      driverId: 12,
      employeeId: "E-1024",
      email: "j@fleetops.ph",
      firstName: "Jose",
      lastName: "Rizal",
      status: "active",
      role: "driver",
    };
    expect(resolveDriverId(driver)).toBe("E-1024");
  });
  it("prefers employeeId, then driverId, then employee_id, then id, then driver_id", () => {
    expect(resolveDriverId({ employeeId: "E1", driverId: "D1", id: "X" })).toBe("E1");
    expect(resolveDriverId({ driverId: "D1", id: "X" })).toBe("D1");
    expect(resolveDriverId({ employee_id: "E1", id: "X" })).toBe("E1");
    expect(resolveDriverId({ id: 42 })).toBe("42");
    expect(resolveDriverId({ driver_id: "D7" })).toBe("D7");
  });
  it("returns null when unknown so callers skip the cache", () => {
    expect(resolveDriverId(null)).toBeNull();
    expect(resolveDriverId({})).toBeNull();
  });
});

describe("setCached / getCached", () => {
  it("round-trips data with a syncedAt timestamp", async () => {
    const before = Date.now();
    await setCached("E1", CACHE_KEYS.TRIPS_ALL, [{ trip_id: 1 }]);
    const entry = await getCached("E1", CACHE_KEYS.TRIPS_ALL);
    expect(entry.data).toEqual([{ trip_id: 1 }]);
    expect(entry.syncedAt).toBeGreaterThanOrEqual(before);
  });
  it("isolates drivers: B never reads A's trips", async () => {
    await setCached("A", CACHE_KEYS.TRIPS_ALL, [{ trip_id: 1 }]);
    expect(await getCached("B", CACHE_KEYS.TRIPS_ALL)).toBeNull();
  });
  it("returns null for corrupt JSON instead of throwing", async () => {
    await store.setItem("fleetops_cache:E1:trips:all", "{not json");
    expect(await getCached("E1", CACHE_KEYS.TRIPS_ALL)).toBeNull();
  });
  it("is a no-op for unknown driverId and never throws", async () => {
    await expect(setCached(null, CACHE_KEYS.TRIPS_ALL, [])).resolves.toBeUndefined();
    expect(await getCached(null, CACHE_KEYS.TRIPS_ALL)).toBeNull();
    expect(await getCached("E1", null)).toBeNull();
  });
});

describe("clearOfflineCache", () => {
  it("wipes static keys plus dynamic trip: keys for that driver only", async () => {
    await setCached("A", CACHE_KEYS.TRIPS_ALL, [1]);
    await setCached("A", tripCacheKey(9), { trip_id: 9 });
    await setCached("A", CACHE_KEYS.LEAVES, [2]);
    await setCached("B", CACHE_KEYS.TRIPS_ALL, [3]);
    await clearOfflineCache("A");
    expect(await getCached("A", CACHE_KEYS.TRIPS_ALL)).toBeNull();
    expect(await getCached("A", tripCacheKey(9))).toBeNull();
    expect(await getCached("A", CACHE_KEYS.LEAVES)).toBeNull();
    expect((await getCached("B", CACHE_KEYS.TRIPS_ALL)).data).toEqual([3]);
  });
  it("is a no-op for unknown driverId", async () => {
    await expect(clearOfflineCache(null)).resolves.toBeUndefined();
  });
});

describe("formatLastSynced", () => {
  const NOW = new Date(2026, 8, 8, 12, 0, 0).getTime();
  it("formats recent ages", () => {
    expect(formatLastSynced(NOW - 10 * 1000, NOW)).toBe("just now");
    expect(formatLastSynced(NOW - 12 * 60000, NOW)).toBe("12 min ago");
    expect(formatLastSynced(NOW - 3 * 3600000, NOW)).toBe("3h ago");
  });
  it("formats yesterday and older days", () => {
    const y = new Date(2026, 8, 7, 16, 32, 0).getTime();
    expect(formatLastSynced(y, NOW)).toBe("yesterday at 04:32 PM");
    const old = new Date(2026, 8, 4, 9, 5, 0).getTime();
    expect(formatLastSynced(old, NOW)).toBe("Sep 4 at 09:05 AM");
  });
  it("returns null for missing timestamps", () => {
    expect(formatLastSynced(null, NOW)).toBeNull();
    expect(formatLastSynced(undefined, NOW)).toBeNull();
  });
});
