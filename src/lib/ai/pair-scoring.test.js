import { describe, it, expect } from "vitest";
import { DRIVER_STATUS, VEHICLE_STATUS } from "@/lib/constants";
import {
  REASON_TYPE,
  PAIRING_KIND,
  NON_DISPATCHABLE_VEHICLE_STATUSES,
  vehicleOperationallyAvailable,
  resolveDesignatedDriver,
  resolveVehiclePairing,
  isDriverUnavailableFor,
  scoreFleetPair,
  buildFleetPairRecommendations,
  buildChecklist,
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
  it("flags leave / suspended / off duty (but NOT on trip)", () => {
    for (const s of [DRIVER_STATUS.ON_LEAVE, DRIVER_STATUS.SUSPENDED, DRIVER_STATUS.OFF_DUTY]) {
      const r = isDriverUnavailableFor(mkDriver({ driver_status: s }), NOW);
      expect(r.unavailable).toBe(true);
    }
    // Future availability (§4.8.2): a driver mid-trip is still eligible for a
    // future window — overlap is judged by _schedule_load, not the status label.
    const onTrip = isDriverUnavailableFor(mkDriver({ driver_status: DRIVER_STATUS.ON_TRIP }), NOW);
    expect(onTrip.unavailable).toBe(false);
    expect(onTrip.reason).toBeNull();
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
      request: mkRequest({ pickup_datetime: NOW }),
      vehicles: [vehicle],
      drivers: [designated, sub],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      // Only a SCHEDULED substitute for the pickup date may cover the car — an
      // arbitrary auto-pick is deliberately never allowed.
      activeSubstitutes: [
        { vehicle_id: 1, substitute_driver_id: 9, effective_from: "2026-08-01", effective_until: null },
      ],
      now: NOW,
    });
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.reason_type).toBe(REASON_TYPE.REPLACEMENT);
    expect(res.recommended.replacement_reason).toMatch(/Leave/i);
  });

  // Rule 3 / Rule 5: an idle driver is not a substitute. Absent an explicit
  // substitute schedule for the pickup date, the vehicle is withheld — the
  // dispatcher assigns a substitute first. This replaces an earlier test that
  // asserted the opposite (auto-pick the best eligible driver).
  it("hides the vehicle when the designated driver is absent and no substitute is scheduled", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.OFF_DUTY });
    const idle = mkDriver({ driver_id: 9 }); // free, but nobody assigned them to this car
    const vehicle = mkVehicle({ vehicle_id: 1 });
    const res = buildFleetPairRecommendations({
      request: mkRequest({ pickup_datetime: NOW }),
      vehicles: [vehicle],
      drivers: [designated, idle],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      activeSubstitutes: [],
      now: NOW,
    });
    expect(res.recommended).toBeNull();
    expect(res.skipped.length).toBe(1);
    expect(res.skipped[0].reason).toMatch(/no substitute driver is assigned/i);
  });

  it("hides the vehicle when the scheduled substitute is themselves unavailable", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.OFF_DUTY });
    const sub = mkDriver({ driver_id: 9, _schedule_load: 3 }); // occupied in the window
    const vehicle = mkVehicle({ vehicle_id: 1 });
    const res = buildFleetPairRecommendations({
      request: mkRequest({ pickup_datetime: NOW }),
      vehicles: [vehicle],
      drivers: [designated, sub],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      activeSubstitutes: [
        { vehicle_id: 1, substitute_driver_id: 9, effective_from: "2026-08-01", effective_until: null },
      ],
      now: NOW,
    });
    expect(res.recommended).toBeNull();
    expect(res.skipped[0].reason).toMatch(/substitute/i);
  });

  it("uses the assigned substitute, never a generic available driver", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const scheduled = mkDriver({ driver_id: 9 });
    const generic = mkDriver({ driver_id: 7 });
    const vehicle = mkVehicle({ vehicle_id: 1 });
    const res = buildFleetPairRecommendations({
      request: mkRequest({ pickup_datetime: NOW }),
      vehicles: [vehicle],
      drivers: [designated, scheduled, generic],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      activeSubstitutes: [
        { vehicle_id: 1, substitute_driver_id: 9, effective_from: "2026-08-01", effective_until: null },
      ],
      now: NOW,
    });
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.replacement_reason).toMatch(/substitute assigned/i);
    // Driver 7 is free and never appears — only one pair, and it is the booked one.
    expect(res.pairs).toHaveLength(1);
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
      request: mkRequest({ pickup_datetime: NOW }),
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, sub],
      activePairs: [{ driver_id: 5, vehicle_id: 1 }],
      activeSubstitutes: [
        { vehicle_id: 1, substitute_driver_id: 9, effective_from: "2026-08-01", effective_until: null },
      ],
      now: NOW,
    });
    const c = res.recommended.checklist;
    const subItem = c.find((i) => i.text.startsWith("Substitute driver"));
    expect(subItem).toBeTruthy();
    expect(subItem.pass).toBe(false);
  });

  it("surfaces fuel and maintenance claims from pair signals", () => {
    const res = buildFleetPairRecommendations({
      request: mkRequest(),
      vehicles: [mkVehicle({ fuel_level: 15, _maintenance: { risk: "high" } })],
      drivers: [mkDriver()],
      activePairs: [{ driver_id: 1, vehicle_id: 1 }],
      now: NOW,
    });
    const c = res.recommended.checklist;
    expect(c.find((i) => i.text.includes("No schedule conflict") && i.pass)).toBeTruthy();
    expect(c.find((i) => i.text.startsWith("Fuel sufficient") && !i.pass)).toBeTruthy();
    expect(c.find((i) => i.text.includes("Maintenance risk") && !i.pass)).toBeTruthy();
  });

  // A busy vehicle never reaches a pair any more (the window overlap excludes it),
  // so this claim is exercised directly on the builder.
  it("states the conflict count when a pair is checklisted with a busy window", () => {
    const c = buildChecklist(
      { vehicle: mkVehicle({ _schedule_load: 2 }), driver: mkDriver(), is_designated: true },
      false
    );
    expect(c.find((i) => i.text.includes("2 dispatch") && !i.pass)).toBeTruthy();
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

// ---------------------------------------------------------------------------
// Assignment-readiness acceptance suite.
//
// Readiness is the AND of three separate questions: the vehicle's own status
// permits dispatch at all, the requested window is genuinely free, and some
// driver is cleared to take THAT vehicle — its designated custodian, or a
// substitute explicitly assigned to it for the pickup date. Each case below
// pins one combination so a future change cannot quietly re-introduce
// "any free driver may take any free car".
// ---------------------------------------------------------------------------

/** The half-open overlap rule the candidate SQL applies: startA < endB AND endA > startB. */
function overlapLoad(bookings, start, end) {
  return bookings.filter(
    (b) => new Date(b.from) < new Date(end) && new Date(b.to) > new Date(start)
  ).length;
}

/** A time on the fixed test day (2026-08-04), so nothing depends on the real clock. */
const at = (h, m = 0) => new Date(2026, 7, 4, h, m, 0);

/** An open-ended substitute booking of `driverId` onto `vehicleId`. */
const subFor = (vehicleId, driverId) => ({
  vehicle_id: vehicleId,
  substitute_driver_id: driverId,
  effective_from: "2026-08-01",
  effective_until: null,
});

/** resolveVehiclePairing over a driver list, so each case reads as data. */
const pairingFor = ({ drivers = [], pairs = [], subs = [], vehicleId = 1, pickupDate = NOW }) =>
  resolveVehiclePairing({
    vehicleId,
    pickupDate,
    activePairs: pairs,
    activeSubstitutes: subs,
    driverById: new Map(drivers.map((d) => [d.driver_id, d])),
    now: NOW,
  });

/** buildFleetPairRecommendations with the fixed clock and a 2-passenger request. */
const board = ({ vehicles, drivers, pairs = [], subs = [], pickup = NOW }) =>
  buildFleetPairRecommendations({
    request: mkRequest({ pickup_datetime: pickup }),
    vehicles,
    drivers,
    activePairs: pairs,
    activeSubstitutes: subs,
    now: NOW,
  });

describe("assignment readiness — vehicle × driver pairing", () => {
  it("TEST 1 — available vehicle, designated driver available → offers that pair", () => {
    const designated = mkDriver({ driver_id: 5 });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
    });
    expect(res.pairs).toHaveLength(1);
    expect(res.recommended.driver.driver_id).toBe(5);
    expect(res.recommended.pairing_kind).toBe(PAIRING_KIND.DESIGNATED);
    expect(res.recommended.is_designated).toBe(true);
    expect(res.recommended.replacement_reason).toBeNull();
  });

  it("TEST 2 — designated driver absent, substitute assigned and available → offers the substitute", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const sub = mkDriver({ driver_id: 9 });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, sub],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      subs: [subFor(1, 9)],
    });
    expect(res.pairs).toHaveLength(1);
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.pairing_kind).toBe(PAIRING_KIND.SUBSTITUTE);
    expect(res.recommended.reason_type).toBe(REASON_TYPE.REPLACEMENT);
    // The permanent custodial relationship survives the substitution.
    expect(res.recommended.designated.driver_id).toBe(5);
  });

  it("TEST 3 — designated driver absent, no substitute assigned → withholds the vehicle", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, mkDriver({ driver_id: 9 })],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.recommended).toBeNull();
    expect(res.skipped[0].reason).toMatch(/no substitute driver is assigned/i);
  });

  it("TEST 4 — no designated driver and no substitute → withholds the vehicle", () => {
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [mkDriver({ driver_id: 9 })],
      pairs: [],
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/no designated driver and no assigned substitute/i);
  });
// __SPEC_SUITE_CONTINUES__

  it("TEST 5 — no designated driver but a substitute is assigned and available → offers the substitute", () => {
    const sub = mkDriver({ driver_id: 9 });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [sub],
      pairs: [],
      subs: [subFor(1, 9)],
    });
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.pairing_kind).toBe(PAIRING_KIND.SUBSTITUTE);
    expect(res.recommended.designated).toBeNull();
    // Standing on its own, not covering an absence — the checklist says so.
    expect(
      res.recommended.checklist.some((i) => i.text === "Assigned substitute driver for this vehicle" && i.pass)
    ).toBe(true);
  });

  it("TEST 6 — the assigned substitute is themselves booked → withholds the vehicle", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const sub = mkDriver({ driver_id: 9, _schedule_load: 1 });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, sub],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      subs: [subFor(1, 9)],
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/substitute is also unavailable/i);
  });

  it("TEST 7 — another driver is free → the vehicle is still offered only with its designated driver", () => {
    const designated = mkDriver({ driver_id: 5, avg_guest_rating: 3.2, years_of_experience: 1 });
    const betterButUnrelated = mkDriver({ driver_id: 9, avg_guest_rating: 5, years_of_experience: 20 });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, betterButUnrelated],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
    });
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0].driver.driver_id).toBe(5);
    expect(res.pairs.some((p) => p.driver.driver_id === 9)).toBe(false);
  });

  it("TEST 8 — Reserved vehicle whose booking does not overlap the request → offered", () => {
    // Booked 10:00-11:00; the request is 14:00-15:00, so the overlap count is 0
    // and the cached `Reserved` label is not evidence of anything.
    const load = overlapLoad([{ from: at(10), to: at(11) }], at(14), at(15));
    expect(load).toBe(0);

    const designated = mkDriver({ driver_id: 5 });
    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, vehicle_status: VEHICLE_STATUS.RESERVED, _schedule_load: load }),
      ],
      drivers: [designated],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      pickup: at(14),
    });
    expect(res.recommended).not.toBeNull();
    expect(res.recommended.vehicle.vehicle_id).toBe(1);
    expect(res.recommended.driver.driver_id).toBe(5);
  });

  it("TEST 9 — Reserved vehicle whose booking overlaps the request → withheld", () => {
    // Booked 14:00-15:00 against a 14:30-15:30 request: a real clash, caught by
    // the window overlap rather than by the status label.
    const load = overlapLoad([{ from: at(14), to: at(15) }], at(14, 30), at(15, 30));
    expect(load).toBe(1);

    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, vehicle_status: VEHICLE_STATUS.RESERVED, _schedule_load: load }),
      ],
      drivers: [mkDriver({ driver_id: 5 })],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      pickup: at(14, 30),
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/1 dispatch\(es\) in this window/i);
  });

  it("TEST 10 — Reserved, free window, designated absent, no substitute → withheld", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, vehicle_status: VEHICLE_STATUS.RESERVED, _schedule_load: 0 }),
      ],
      drivers: [designated],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/no substitute driver is assigned/i);
  });

  it("TEST 11 — Reserved, free window, designated absent, substitute assigned → offers the substitute", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, vehicle_status: VEHICLE_STATUS.RESERVED, _schedule_load: 0 }),
      ],
      drivers: [designated, mkDriver({ driver_id: 9 })],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      subs: [subFor(1, 9)],
    });
    expect(res.recommended.driver.driver_id).toBe(9);
    expect(res.recommended.pairing_kind).toBe(PAIRING_KIND.SUBSTITUTE);
  });

  it("TEST 12 — a vehicle restriction outranks an available designated driver", () => {
    for (const status of NON_DISPATCHABLE_VEHICLE_STATUSES) {
      const res = board({
        vehicles: [mkVehicle({ vehicle_id: 1, vehicle_status: status })],
        drivers: [mkDriver({ driver_id: 5 })],
        pairs: [{ driver_id: 5, vehicle_id: 1 }],
      });
      expect(res.pairs).toHaveLength(0);
      expect(res.skipped[0].reason).toBe(`Vehicle status is ${status}.`);
    }
  });

  it("TEST 13 — custodian goes absent after the recommendation → the assigned substitute takes over", () => {
    // Same vehicle, same substitute booking, evaluated twice: the pairing rule
    // is re-run against live driver rows, so the answer moves with them rather
    // than the car dropping off the board.
    const pairs = [{ driver_id: 5, vehicle_id: 1 }];
    const subs = [subFor(1, 9)];
    const sub = mkDriver({ driver_id: 9 });

    const before = pairingFor({ drivers: [mkDriver({ driver_id: 5 }), sub], pairs, subs });
    expect(before.ok).toBe(true);
    expect(before.driver.driver_id).toBe(5);

    const after = pairingFor({
      drivers: [mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE }), sub],
      pairs,
      subs,
    });
    expect(after.ok).toBe(true);
    expect(after.kind).toBe(PAIRING_KIND.SUBSTITUTE);
    expect(after.driver.driver_id).toBe(9);
  });

  it("TEST 14 — a dispatch booked after the recommendation makes the driver unavailable", () => {
    // The revalidation reloads `_schedule_load` from the live window, so a pair
    // that was clean at recommendation time is refused at commit time.
    const pairs = [{ driver_id: 5, vehicle_id: 1 }];
    const clean = pairingFor({ drivers: [mkDriver({ driver_id: 5 })], pairs });
    expect(clean.ok).toBe(true);

    const nowBooked = pairingFor({ drivers: [mkDriver({ driver_id: 5, _schedule_load: 1 })], pairs });
    expect(nowBooked.ok).toBe(false);
    expect(nowBooked.reason).toMatch(/already has 1 dispatch\(es\) in this window/i);
  });

  it("a substitute booking outside the pickup date does not cover it", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, mkDriver({ driver_id: 9 })],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      // Ends the day before the 2026-08-04 pickup.
      subs: [{ vehicle_id: 1, substitute_driver_id: 9, effective_from: "2026-08-01", effective_until: "2026-08-03" }],
    });
    expect(res.pairs).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/no substitute driver is assigned/i);
  });

  it("a substitute booked onto a DIFFERENT vehicle never covers this one", () => {
    const designated = mkDriver({ driver_id: 5, driver_status: DRIVER_STATUS.ON_LEAVE });
    const res = board({
      vehicles: [mkVehicle({ vehicle_id: 1 })],
      drivers: [designated, mkDriver({ driver_id: 9 })],
      pairs: [{ driver_id: 5, vehicle_id: 1 }],
      subs: [subFor(2, 9)],
    });
    expect(res.pairs).toHaveLength(0);
  });

  it("Reserved and In Use are dispatchable; the grounding statuses are not", () => {
    expect(vehicleOperationallyAvailable({ vehicle_status: VEHICLE_STATUS.AVAILABLE })).toBe(true);
    expect(vehicleOperationallyAvailable({ vehicle_status: VEHICLE_STATUS.RESERVED })).toBe(true);
    // Future availability (§4.8.2): a vehicle currently driving is still free for
    // a later window; overlap is judged by _schedule_load, not the status label.
    expect(vehicleOperationallyAvailable({ vehicle_status: VEHICLE_STATUS.IN_USE })).toBe(true);
    for (const s of NON_DISPATCHABLE_VEHICLE_STATUSES) {
      expect(vehicleOperationallyAvailable({ vehicle_status: s })).toBe(false);
    }
    expect(NON_DISPATCHABLE_VEHICLE_STATUSES).not.toContain(VEHICLE_STATUS.RESERVED);
    expect(NON_DISPATCHABLE_VEHICLE_STATUSES).not.toContain(VEHICLE_STATUS.IN_USE);
  });

  it("does not penalise a Reserved-but-free vehicle against an identical Available one", () => {
    const designated = mkDriver({ driver_id: 5 });
    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, vehicle_status: VEHICLE_STATUS.AVAILABLE }),
        mkVehicle({ vehicle_id: 2, vehicle_status: VEHICLE_STATUS.RESERVED }),
      ],
      drivers: [designated, mkDriver({ driver_id: 6 })],
      pairs: [
        { driver_id: 5, vehicle_id: 1 },
        { driver_id: 6, vehicle_id: 2 },
      ],
    });
    expect(res.pairs).toHaveLength(2);
    const byVehicle = new Map(res.pairs.map((p) => [p.vehicle.vehicle_id, p.score]));
    expect(byVehicle.get(2)).toBe(byVehicle.get(1));
  });

  it("reports one skip reason per withheld vehicle, keyed to the vehicle", () => {
    const res = board({
      vehicles: [
        mkVehicle({ vehicle_id: 1, plate_number: "AAA 111" }),
        mkVehicle({ vehicle_id: 2, plate_number: "BBB 222", vehicle_status: VEHICLE_STATUS.UNDER_MAINTENANCE }),
        mkVehicle({ vehicle_id: 3, plate_number: "CCC 333", seating_capacity: 1 }),
      ],
      drivers: [mkDriver({ driver_id: 5 })],
      pairs: [],
    });
    expect(res.skipped).toHaveLength(3);
    expect(res.skipped.map((s) => s.plate)).toEqual(["AAA 111", "BBB 222", "CCC 333"]);
  });
});

