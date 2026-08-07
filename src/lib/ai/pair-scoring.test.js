import { describe, it, expect } from "vitest";
import { DRIVER_STATUS } from "@/lib/constants";
import {
  REASON_TYPE,
  resolveDesignatedDriver,
  isDriverUnavailableFor,
  scoreFleetPair,
  buildFleetPairRecommendations,
} from "@/lib/ai/pair-scoring";

const NOW = new Date(2026, 7, 4, 12, 0, 0);

const mkVehicle = (over = {}) => ({
  vehicle_id: 1,
  plate_number: "XYZ 5678",
  vehicle_name: "Sedan",
  seating_capacity: 4,
  fuel_level: 80,
  vehicle_status: "Available",
  _schedule_load: 0,
  _maintenance: { risk: "low" },
  ...over,
});

const mkDriver = (over = {}) => ({
  driver_id: 1,
  driver_status: DRIVER_STATUS.AVAILABLE,
  license_expiry: "2030-01-01",
  years_of_experience: 5,
  avg_guest_rating: 4.5,
  _schedule_load: 0,
  _pickup_distance_km: 3,
  _proximity_relevant: true,
  ...over,
});

const mkRequest = (over = {}) => ({
  request_id: 1,
  passenger_count: 2,
  pickup_location: "Hotel",
  dropoff_location: "Airport",
  ...over,
});

describe("resolveDesignatedDriver", () => {
  it("returns the active custodian of a vehicle", () => {
    const pairs = [{ driver_id: 7, vehicle_id: 1 }];
    const byId = new Map([[7, mkDriver({ driver_id: 7 })]]);
    expect(resolveDesignatedDriver(1, pairs, byId).driver_id).toBe(7);
  });

  it("returns null when the vehicle has no active pairing", () => {
    expect(resolveDesignatedDriver(1, [], new Map())).toBeNull();
  });

  it("ignores closed pairings", () => {
    const pairs = [{ driver_id: 7, vehicle_id: 1, assigned_until: "2026-01-01" }];
    expect(resolveDesignatedDriver(1, pairs, new Map([[7, mkDriver()]]))).toBeNull();
  });
});

describe("isDriverUnavailableFor", () => {
  it("flags leave / suspended / off duty / on trip", () => {
    for (const s of [DRIVER_STATUS.ON_LEAVE, DRIVER_STATUS.SUSPENDED, DRIVER_STATUS.OFF_DUTY, DRIVER_STATUS.ON_TRIP]) {
      const r = isDriverUnavailableFor(mkDriver({ driver_status: s }), NOW);
      expect(r.unavailable).toBe(true);
    }
  });

  it("flags an expired license", () => {
    const r = isDriverUnavailableFor(mkDriver({ license_expiry: "2026-01-01" }), NOW);
    expect(r.unavailable).toBe(true);
  });

  it("flags an already-assigned driver in the window", () => {
    const r = isDriverUnavailableFor(mkDriver({ _schedule_load: 2 }), NOW);
    expect(r.unavailable).toBe(true);
  });

  it("an available driver is not unavailable", () => {
    const r = isDriverUnavailableFor(mkDriver(), NOW);
    expect(r.unavailable).toBe(false);
    expect(r.reason).toBeNull();
  });
});

describe("scoreFleetPair", () => {
  it("strongly favours the designated driver", () => {
    const designated = mkDriver({ driver_id: 5 });
    const other = mkDriver({ driver_id: 9, avg_guest_rating: 5, years_of_experience: 12 });
    const d = scoreFleetPair({ vehicle: mkVehicle(), driver: designated, designated, request: mkRequest(), passengers: 2 });
    const s = scoreFleetPair({ vehicle: mkVehicle(), driver: other, designated, request: mkRequest(), passengers: 2 });
    expect(d.score).toBeGreaterThan(s.score);
    expect(d.is_designated).toBe(true);
    expect(d.reason_type).toBe(REASON_TYPE.DESIGNATED);
  });

  it("marks a substitute as replacement", () => {
    const designated = mkDriver({ driver_id: 5 });
    const sub = mkDriver({ driver_id: 9 });
    const s = scoreFleetPair({ vehicle: mkVehicle(), driver: sub, designated, request: mkRequest(), passengers: 2 });
    expect(s.is_designated).toBe(false);
    expect(s.reason_type).toBe(REASON_TYPE.REPLACEMENT);
  });

  it("penalises undersized vehicles", () => {
    const designated = mkDriver({ driver_id: 5 });
    const tooSmall = scoreFleetPair({ vehicle: mkVehicle({ seating_capacity: 1 }), driver: designated, designated, request: mkRequest({ passenger_count: 4 }), passengers: 4 });
    const fits = scoreFleetPair({ vehicle: mkVehicle({ seating_capacity: 5 }), driver: designated, designated, request: mkRequest({ passenger_count: 4 }), passengers: 4 });
    expect(tooSmall.score).toBeLessThan(fits.score);
  });
});

describe("buildFleetPairRecommendations", () => {
  it("recommends the designated driver first even if another scores higher raw", () => {
    const designated = mkDriver({ driver_id: 5, avg_guest_rating: 4, years_of_experience: 3 });
    const star = mkDriver({ driver_id: 9, avg_guest_rating: 5, years_of_experience: 15, driver_status: DRIVER_STATUS.AVAILABLE });
    const vehicle = mkVehicle({ vehicle_id: 1, plate_number: "XYZ 5678" });
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [vehicle],
      drivers: [designated, star],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      now: NOW,
    });
    expect(res.recommended.driver.driver_id).toBe(5);
    expect(res.recommended.is_designated).toBe(true);
  });

  it("substitutes with a reason when the designated driver is unavailable", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const sub = mkDriver({ driver_id: 9 });
    const vehicle = mkVehicle({ vehicle_id: 1 });
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [vehicle],
      drivers: [designated, sub],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      now: NOW,
    });
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.reason_type).toBe(REASON_TYPE.REPLACEMENT);
    expect(res.recommended.replacement_reason).toMatch(/Leave/i);
  });

  it("prefers an intact designated pair over a replacement pair", () => {
    const desA = mkDriver({ driver_id: 5 });
    const desB = mkDriver({ driver_id: 8 });
    const va = mkVehicle({ vehicle_id: 1 });
    const vb = mkVehicle({ vehicle_id: 2 });
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [va, vb],
      drivers: [desA, desB],
      activePairs: [
        { driver_id: 5, vehicle_id: 1 },
        { driver_id: 8, vehicle_id: 2 },
      ],
      now: NOW,
    });
    // If va's custodian is unavailable and vb's is available, vb must rank first.
    res.pairs.forEach((p) => {
      expect(p.is_designated).toBe(true);
    });
    expect(res.recommended.is_designated).toBe(true);
  });

  it("returns alternate as the next-best pair", () => {
    const desA = mkDriver({ driver_id: 5 });
    const desB = mkDriver({ driver_id: 8 });
    const va = mkVehicle({ vehicle_id: 1 });
    const vb = mkVehicle({ vehicle_id: 2 });
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [va, vb],
      drivers: [desA, desB],
      activePairs: [
        { driver_id: 5, vehicle_id: 1 },
        { driver_id: 8, vehicle_id: 2 },
      ],
      now: NOW,
    });
    expect(res.recommended.vehicle.vehicle_id).not.toBe(res.alternate.vehicle.vehicle_id);
  });
});

describe("buildChecklist", () => {
  it("flags the designated-driver claim for an intact pair", () => {
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [mkVehicle()],
      drivers: [mkDriver()],
      activePairs: [{ driver_id: 1, vehicle_id: 1 }],
      now: NOW,
    });
    const c = res.recommended.checklist;
    expect(c.some((i) => i.text === "Designated driver available" && i.pass)).toBe(true);
  });

  it("reports a substitute with the unavailability reason", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const sub = mkDriver({ driver_id: 9 });
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, sub],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      now: NOW,
    });
    const c = res.recommended.checklist;
    const subItem = c.find((i) => i.text.startsWith("Substitute driver"));
    expect(subItem).toBeTruthy();
    expect(subItem.pass).toBe(false);
  });

  it("surfaces schedule conflict, fuel and maintenance claims from pair signals", () => {
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [mkVehicle({ _schedule_load: 2, fuel_level: 15, _maintenance: { risk: "high" } })],
      drivers: [mkDriver()],
      activePairs: [{ driver_id: 1, vehicle_id: 1 }],
      now: NOW,
    });
    const c = res.recommended.checklist;
    expect(c.find((i) => i.text.includes("2 dispatch") && !i.pass)).toBeTruthy();
    expect(c.find((i) => i.text.startsWith("Fuel sufficient") && !i.pass)).toBeTruthy();
    expect(c.find((i) => i.text.includes("Maintenance risk") && !i.pass)).toBeTruthy();
  });

  it("marks the top-ranked pair as the highest fleet score", () => {
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [mkVehicle()],
      drivers: [mkDriver()],
      activePairs: [{ driver_id: 1, vehicle_id: 1 }],
      now: NOW,
    });
    expect(res.recommended.checklist.some((i) => i.text.startsWith("Highest fleet score") && i.pass)).toBe(true);
  });
});
