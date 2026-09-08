/**
 * Driver-context tests (driver-context.js) — the vehicle resolver behind
 * offline Report Incident / Fuel Report / Assigned Vehicle. Pins the locked
 * priority chain and BOTH wire shapes (snake_case trip rows + mobile/me,
 * camelCase /driver/me assignedVehicle) — the resolveDriverId lesson: test
 * the exact shapes the server sends, not an imagined one.
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
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { setCached, CACHE_KEYS } from "./offline-cache";
import { resolveVehicleContext, getCachedVehicleContext } from "./driver-context";

beforeEach(() => {
  AsyncStorage.__clear();
});

// Exact trip-row shape from GET /api/mobile/driver/trips (snake_case).
const TRIP_ROW = (over = {}) => ({
  trip_id: 9,
  trip_status: "Trip Started",
  vehicle_id: 12,
  vehicle_plate: "ABC-1234",
  vehicle_model: "Toyota Hiace",
  ...over,
});

// Exact /api/driver/me assignedVehicle shape (camelCase).
const ME_CAMEL = {
  employeeId: "E-1",
  assignedVehicle: { vehicleId: 30, plateNumber: "XYZ-9999", model: "Nissan Urvan" },
};

// Exact /api/mobile/driver/me assignedVehicle shape (snake_case).
const ME_MOBILE = {
  driverId: 5,
  assignedVehicle: { vehicle_id: 30, plate_number: "XYZ-9999", model: "Nissan Urvan" },
};

describe("resolveVehicleContext — priority chain", () => {
  it("1. explicit trip wins over active trip and standing assignment", () => {
    const r = resolveVehicleContext({
      trip: TRIP_ROW({ trip_id: 77, vehicle_id: 99, vehicle_plate: "EXPL-77" }),
      trips: [TRIP_ROW()],
      me: ME_CAMEL,
    });
    expect(r).toEqual({ vehicleId: 99, plate: "EXPL-77" });
  });

  it("2. active trip vehicle wins over standing assignment", () => {
    const r = resolveVehicleContext({
      trips: [TRIP_ROW({ trip_status: "En Route" }), TRIP_ROW({ trip_id: 8, trip_status: "Completed" })],
      me: ME_CAMEL,
    });
    expect(r).toEqual({ vehicleId: 12, plate: "ABC-1234" });
  });

  it("2b. skips finished trips when hunting an active one", () => {
    const r = resolveVehicleContext({
      trips: [TRIP_ROW({ trip_status: "Completed" }), TRIP_ROW({ trip_status: "Cancelled" })],
      me: null,
    });
    expect(r).toBeNull();
  });

  it("3. falls to the standing assignment (camelCase /driver/me shape)", () => {
    const r = resolveVehicleContext({ trips: [], me: ME_CAMEL });
    expect(r).toEqual({ vehicleId: 30, plate: "XYZ-9999" });
  });

  it("3b. standing assignment also resolves from the mobile/me snake_case shape", () => {
    const r = resolveVehicleContext({ trips: [], me: ME_MOBILE });
    expect(r).toEqual({ vehicleId: 30, plate: "XYZ-9999" });
  });

  it("4. returns null when nothing is provable — never a recent trip's vehicle", () => {
    // The exact anti-pattern this module exists to kill: a recent but FINISHED
    // trip must not masquerade as a current assignment.
    const r = resolveVehicleContext({
      trips: [TRIP_ROW({ trip_status: "Completed", vehicle_id: 12, vehicle_plate: "OLD-1" })],
      me: { assignedVehicle: null },
    });
    expect(r).toBeNull();
  });

  it("honors a custom active-status list (e.g. fuel's non-terminal set)", () => {
    const r = resolveVehicleContext({
      trips: [TRIP_ROW({ trip_status: "Assigned" })],
      activeStatuses: ["Assigned", "Driver Accepted", "Trip Started"],
    });
    expect(r).toEqual({ vehicleId: 12, plate: "ABC-1234" });
  });

  it("edge inputs never throw", () => {
    expect(resolveVehicleContext()).toBeNull();
    expect(resolveVehicleContext({ trips: null, me: null, trip: null })).toBeNull();
    expect(resolveVehicleContext({ trips: [null], me: {} })).toBeNull();
    // trip present but vehicleless → falls through, doesn't crash.
    expect(resolveVehicleContext({ trip: { trip_id: 1 }, trips: [], me: null })).toBeNull();
  });
});

describe("getCachedVehicleContext — reads the caches core screens write", () => {
  it("resolves from TRIPS_ALL + DRIVER_ME", async () => {
    await setCached("E1", CACHE_KEYS.TRIPS_ALL, [TRIP_ROW()]);
    await setCached("E1", CACHE_KEYS.DRIVER_ME, ME_CAMEL);
    const ctx = await getCachedVehicleContext("E1");
    expect(ctx.trips).toEqual([TRIP_ROW()]);
    expect(ctx.me).toEqual(ME_CAMEL);
    expect(resolveVehicleContext(ctx)).toEqual({ vehicleId: 12, plate: "ABC-1234" });
  });

  it("falls back to HOME_TRIPS when TRIPS_ALL is absent (Home writes that key)", async () => {
    await setCached("E1", CACHE_KEYS.HOME_TRIPS, [TRIP_ROW({ trip_status: "Completed" })]);
    await setCached("E1", CACHE_KEYS.DRIVER_ME, ME_CAMEL);
    const r = resolveVehicleContext(await getCachedVehicleContext("E1"));
    expect(r).toEqual({ vehicleId: 30, plate: "XYZ-9999" }); // no active trip → assignment
  });

  it("empty caches read as nulls, resolution null, no throw", async () => {
    const ctx = await getCachedVehicleContext("E2");
    expect(ctx).toEqual({ trips: null, me: null });
    expect(resolveVehicleContext(ctx)).toBeNull();
  });

  it("unknown driverId short-circuits to nulls", async () => {
    expect(await getCachedVehicleContext(null)).toEqual({ trips: null, me: null });
  });
});
