// Tests for the trip lifecycle service's monitor-alert resolution (PR #4,
// review correction #5).
//
// The contract: a trip leaving the live lifecycle (completeTrip / cancelTrip)
// resolves ALL its active trip_monitor_alerts INSIDE the transaction that
// flips the status — so alerts never outlive the trip regardless of whether
// anyone ever opens Live Operations again. The fleet summary's sweep is a
// defensive backstop, never the mechanism.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "@/lib/db";
import { completeTrip, cancelTrip } from "./trip-lifecycle.service";

vi.mock("@/services/status.service", () => ({
  syncVehicleStatus: vi.fn(async () => null),
  syncDriverStatus: vi.fn(async () => null),
}));
vi.mock("@/services/reservation-lifecycle.service", () => ({
  findRequestForDispatch: vi.fn(async () => null),
  advanceReservation: vi.fn(async () => null),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => null) }));

const BEFORE_ROW = {
  vehicle_id: 5,
  driver_id: 7,
  dispatch_id: 55,
  trip_status: "Trip Started",
  vehicle_mileage: 1000,
  planned_distance: 32,
  fuel_efficiency_kmpl: 9,
  fuel_type: "Diesel",
};

const COMPLETED_ROW = {
  trip_id: 101,
  trip_status: "Completed",
  end_odometer: 1100,
  distance: 100,
  gps_distance_km: null,
  start_time: new Date("2026-09-08T09:00:00+08:00").toISOString(),
};

function setup() {
  const txLog = [];
  const txParams = [];
  let resolvedAlerts = 0;

  vi.spyOn(db, "query").mockImplementation(async (sql) => {
    const s = String(sql);
    if (s.includes("SELECT t.vehicle_id, t.driver_id")) return { rows: [BEFORE_ROW] };
    if (s.includes("SELECT vehicle_id, driver_id")) return { rows: [BEFORE_ROW] };
    if (s.includes("FROM gpstracking")) return { rows: [] };
    if (s.includes("fuel_price_region")) return { rows: [{ setting_value: "NCR" }] };
    if (s.includes("FROM fuel_price_snapshots")) {
      return { rows: [{ snapshot_id: 4, reference_price: "62.70" }] };
    }
    if (s.includes("UPDATE trips")) {
      return { rows: [{ ...COMPLETED_ROW, trip_status: s.includes("Cancelled") ? "Cancelled" : "Completed" }] };
    }
    if (s.includes("UPDATE trip_monitor_alerts")) {
      resolvedAlerts += 2;
      return { rows: [{}, {}] };
    }
    return { rows: [] };
  });

  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => {
    const tx = {
      query: async (sql, params) => {
        txLog.push(String(sql));
        txParams.push(params);
        return db.query(sql, params);
      },
    };
    return fn(tx);
  });

  return { txLog, txParams, resolvedAlerts: () => resolvedAlerts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trip lifecycle → monitor alert resolution", () => {
  it("completeTrip resolves active monitor alerts inside the transaction", async () => {
    const { txLog, resolvedAlerts } = setup();
    const row = await completeTrip(101, { user: { employeeId: 1 } }, { endOdometer: 1100 });

    expect(row.trip_status).toBe("Completed");
    // The alert resolution ran as part of the SAME transaction as the status
    // flip — no window where a completed trip still shows active alerts.
    const alertUpdate = txLog.find((s) => s.includes("UPDATE trip_monitor_alerts"));
    expect(alertUpdate).toBeDefined();
    expect(alertUpdate).toContain("WHERE trip_id = $1 AND active");
    expect(resolvedAlerts()).toBe(2);
  });

  it("cancelTrip resolves active monitor alerts inside the transaction", async () => {
    const { txLog } = setup();
    const row = await cancelTrip(101, { user: { employeeId: 1 } }, { reason: "vehicle issue" });

    expect(row.trip_status).toBe("Cancelled");
    const alertUpdate = txLog.find((s) => s.includes("UPDATE trip_monitor_alerts"));
    expect(alertUpdate).toBeDefined();
    expect(alertUpdate).toContain("WHERE trip_id = $1 AND active");
  });

  it("completeTrip snapshots the estimate basis once: 36 km at 9 km/L and PHP 62.70/L", async () => {
    // Odometer 1100 over vehicle mileage 1000 is not a valid derivation here
    // (needs a start reading), so the estimate rides the supplied distance.
    const { txLog, txParams } = setup();
    await completeTrip(101, { user: { employeeId: 1 } }, { endOdometer: 1100, distance: 36 });

    const idx = txLog.findIndex((s) => s.includes("UPDATE trips") && s.includes("estimated_fuel_l"));
    expect(idx).toBeGreaterThan(-1);
    // params: [endOdo, dist, tripId, gps, planned, actual, provenance, liters, cost, price, snapshotId, region]
    const params = txParams[idx];
    expect(params[4]).toBe(32);
    expect(params[5]).toBe(36);
    expect(params[6]).toBe("trip-distance");
    expect(params[7]).toBe(4);
    expect(params[8]).toBe(250.8);
    expect(params[9]).toBe(62.7);
    expect(params[10]).toBe(4);
    expect(params[11]).toBe("NCR");
    // First-write-wins: a stored basis is never rewritten.
    const update = txLog[idx];
    for (const column of [
      "planned_distance_km", "actual_distance_km", "distance_provenance",
      "estimated_fuel_l", "estimated_fuel_cost", "fuel_reference_price",
      "fuel_price_snapshot_id", "fuel_region",
    ]) {
      expect(update).toContain(`COALESCE(${column},`);
    }
    expect(update).not.toContain("fuel_consumed");
  });

  it("completeTrip stores nulls — never zeros — when the basis is missing", async () => {
    const { txLog, txParams } = setup();
    // No efficiency, no region, no snapshot: the trip still completes.
    const { query } = await import("@/lib/db");
    query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes("SELECT t.vehicle_id, t.driver_id")) {
        return { rows: [{ ...BEFORE_ROW, fuel_efficiency_kmpl: null, planned_distance: null }] };
      }
      if (s.includes("fuel_price_region")) return { rows: [] };
      if (s.includes("FROM fuel_price_snapshots")) return { rows: [] };
      if (s.includes("FROM gpstracking")) return { rows: [] };
      if (s.includes("UPDATE trips")) return { rows: [{ ...COMPLETED_ROW }] };
      if (s.includes("UPDATE trip_monitor_alerts")) return { rows: [] };
      return { rows: [] };
    });
    const row = await completeTrip(101, { user: { employeeId: 1 } }, { endOdometer: 1100 });
    expect(row.trip_status).toBe("Completed");
    const idx = txLog.findIndex((s) => s.includes("UPDATE trips") && s.includes("estimated_fuel_l"));
    const params = txParams[idx];
    expect(params[7]).toBeNull();
    expect(params[8]).toBeNull();
  });
});
