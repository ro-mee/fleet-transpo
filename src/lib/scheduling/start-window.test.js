// Tests for the shared start-window resolver — the module that keeps the
// three window consumers (driver trips feed, start gate, notification
// producer) from drifting. Pins:
// - the ETA ladder order (TomTom → haversine heuristic → stored estimate),
//   fail-open to null;
// - parity with computeDepartureWindow (the pure math never diverges);
// - the catch-up rule: when several thresholds are crossed, only the MOST
//   ADVANCED event is reported — one threshold event per trip per run.
import { describe, it, expect } from "vitest";
import { computeDepartureWindow } from "./departure-window";
import { resolveEtaMinutes, resolveStartWindow, crossedStartWindowThreshold } from "./start-window";

const MANILA = [14.5, 121.0];
const NEARBY = [14.505, 121.0]; // ~560 m north of MANILA
const FETCH_FAIL = async () => ({ ok: false });

describe("resolveEtaMinutes — the ETA ladder", () => {
  it("uses TomTom first when it answers", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ routes: [{ summary: { travelTimeInSeconds: 600 } }] }),
    });
    expect(await resolveEtaMinutes({ driverPosition: NEARBY, pickupPosition: MANILA, storedDurationMinutes: 99, fetchImpl })).toBe(10);
  });

  it("falls back to the haversine heuristic when TomTom fails", async () => {
    // NEARBY → MANILA is ~0.56 km → at the 25 km/h heuristic that's ≥1 min,
    // well under the stored 99 — proves the stored estimate did NOT win.
    const eta = await resolveEtaMinutes({ driverPosition: NEARBY, pickupPosition: MANILA, storedDurationMinutes: 99, fetchImpl: FETCH_FAIL });
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThan(10);
  });

  it("falls back to the stored estimate when no position pair exists", async () => {
    expect(await resolveEtaMinutes({ driverPosition: null, pickupPosition: MANILA, storedDurationMinutes: 42, fetchImpl: FETCH_FAIL })).toBe(42);
    expect(await resolveEtaMinutes({ driverPosition: MANILA, pickupPosition: null, storedDurationMinutes: 42, fetchImpl: FETCH_FAIL })).toBe(42);
  });

  it("rejects non-positive stored estimates and fail-opens to null", async () => {
    expect(await resolveEtaMinutes({ driverPosition: null, pickupPosition: null, storedDurationMinutes: 0, fetchImpl: FETCH_FAIL })).toBeNull();
    expect(await resolveEtaMinutes({ driverPosition: null, pickupPosition: null, storedDurationMinutes: -5, fetchImpl: FETCH_FAIL })).toBeNull();
    expect(await resolveEtaMinutes({ driverPosition: null, pickupPosition: null, storedDurationMinutes: null, fetchImpl: FETCH_FAIL })).toBeNull();
  });
});

describe("resolveStartWindow — parity with the pure window", () => {
  const PICKUP = "2026-09-09T10:00:00+08:00";

  it("matches computeDepartureWindow given the same ETA and buffers", async () => {
    const eta = await resolveEtaMinutes({ driverPosition: NEARBY, pickupPosition: MANILA, storedDurationMinutes: null, fetchImpl: FETCH_FAIL });
    const viaShared = await resolveStartWindow({
      pickup: PICKUP, driverPosition: NEARBY, pickupPosition: MANILA,
      storedDurationMinutes: null, departureBufferMinutes: 10, earlyStartAllowanceMinutes: 10,
      fetchImpl: FETCH_FAIL,
    });
    const direct = computeDepartureWindow({ pickup: PICKUP, etaMinutes: eta, departureBufferMinutes: 10, earlyStartAllowanceMinutes: 10 });
    expect(viaShared.recommended_departure.getTime()).toBe(direct.recommended_departure.getTime());
    expect(viaShared.earliest_start.getTime()).toBe(direct.earliest_start.getTime());
    expect(viaShared.latest_start.getTime()).toBe(direct.latest_start.getTime());
  });

  it("honors the dispatch policy buffers the start gate passes", async () => {
    const eta = await resolveEtaMinutes({ driverPosition: NEARBY, pickupPosition: MANILA, storedDurationMinutes: null, fetchImpl: FETCH_FAIL });
    // The start route passes policy.departureBufferMinutes /
    // earlyStartAllowanceMinutes verbatim — a policy edit must shift this
    // window by exactly the same amounts.
    const w = await resolveStartWindow({
      pickup: PICKUP, driverPosition: NEARBY, pickupPosition: MANILA,
      storedDurationMinutes: null, departureBufferMinutes: 15, earlyStartAllowanceMinutes: 5,
      fetchImpl: FETCH_FAIL,
    });
    const pickupMs = new Date(PICKUP).getTime();
    expect(w.recommended_departure.getTime()).toBe(pickupMs - (eta + 15) * 60 * 1000);
    expect(w.earliest_start.getTime()).toBe(pickupMs - (eta + 15 + 5) * 60 * 1000);
  });

  it("returns an all-null window when the pickup is missing", async () => {
    const w = await resolveStartWindow({ pickup: null, driverPosition: MANILA, pickupPosition: MANILA, fetchImpl: FETCH_FAIL });
    expect(w).toMatchObject({ recommended_departure: null, earliest_start: null, latest_start: null, eta_minutes: null });
  });

  it("keeps latest_start (the pickup) even when the ETA cannot resolve", async () => {
    const w = await resolveStartWindow({
      pickup: PICKUP, driverPosition: null, pickupPosition: null,
      storedDurationMinutes: null, fetchImpl: FETCH_FAIL,
    });
    expect(w.recommended_departure).toBeNull();
    expect(w.earliest_start).toBeNull();
    expect(w.latest_start.getTime()).toBe(new Date(PICKUP).getTime());
  });
});

describe("crossedStartWindowThreshold — catch-up rule", () => {
  const PICKUP_MS = new Date("2026-09-09T10:00:00+08:00").getTime();
  // eta 30 + buffer 10 → recommended 10:40 before pickup... build explicitly:
  // pickup 12:00, recommended 11:20, earliest 11:10, latest 12:00.
  const window = {
    recommended_departure: new Date(PICKUP_MS - 40 * 60 * 1000),
    earliest_start: new Date(PICKUP_MS - 50 * 60 * 1000),
    latest_start: new Date(PICKUP_MS),
    eta_minutes: 30,
  };

  it("reports nothing before earliest_start", () => {
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS - 60 * 60 * 1000))).toBeNull();
  });

  it("reports window_open between earliest and recommended", () => {
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS - 45 * 60 * 1000))).toBe("window_open");
  });

  it("reports departure_due between recommended and latest", () => {
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS - 20 * 60 * 1000))).toBe("departure_due");
  });

  it("reports overdue at/after the scheduled pickup", () => {
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS))).toBe("overdue");
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS + 5 * 60 * 1000))).toBe("overdue");
  });

  it("catch-up: both earliest and recommended crossed in one scan → only the more advanced event", () => {
    // A scan that slept through earliest_start (now past recommended) must
    // NOT also report window_open — one threshold event per run.
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS - 30 * 60 * 1000))).toBe("departure_due");
  });

  it("catch-up: everything crossed → only overdue", () => {
    expect(crossedStartWindowThreshold(window, new Date(PICKUP_MS + 1))).toBe("overdue");
  });

  it("overdue works from latest_start alone (ETA unknown)", () => {
    // latest_start is always the pickup, so a trip with no resolvable ETA
    // can still get its late-start alert.
    expect(crossedStartWindowThreshold({ latest_start: new Date(PICKUP_MS) }, new Date(PICKUP_MS + 1))).toBe("overdue");
    expect(crossedStartWindowThreshold({ latest_start: new Date(PICKUP_MS) }, new Date(PICKUP_MS - 1))).toBeNull();
  });

  it("tolerates null window and illegal now", () => {
    expect(crossedStartWindowThreshold(null)).toBeNull();
    expect(crossedStartWindowThreshold(window, "not-a-date")).toBeNull();
  });
});
