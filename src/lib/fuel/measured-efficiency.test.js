import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: state.query }));

import { query } from "@/lib/db";
import {
  MEASURED_EFFICIENCY_WINDOW_DAYS,
  MEASURED_EFFICIENCY_MIN_DISTANCE_KM,
  MEASURED_EFFICIENCY_MIN_RECEIPTS,
  MEASURED_EFFICIENCY_MAX_PROFILE_GAP,
  assessMeasuredEfficiency,
  attachMeasuredEfficiency,
} from "./measured-efficiency";

describe("measured efficiency gates", () => {
  it("pins the signed-off gate numbers", () => {
    expect(MEASURED_EFFICIENCY_WINDOW_DAYS).toBe(90);
    expect(MEASURED_EFFICIENCY_MIN_DISTANCE_KM).toBe(100);
    expect(MEASURED_EFFICIENCY_MIN_RECEIPTS).toBe(3);
    expect(MEASURED_EFFICIENCY_MAX_PROFILE_GAP).toBe(0.35);
  });

  it("refuses to certify a number below any gate", () => {
    expect(assessMeasuredEfficiency({ distanceKm: 99.9, liters: 20, receipts: 4 }, 9)).toMatchObject({
      eligible: false,
      kmpl: null,
    });
    expect(assessMeasuredEfficiency({ distanceKm: 150, liters: 20, receipts: 2 }, 9)).toMatchObject({
      eligible: false,
      kmpl: null,
    });
    expect(assessMeasuredEfficiency({ distanceKm: 150, liters: 0, receipts: 4 }, 9)).toMatchObject({
      eligible: false,
      kmpl: null,
    });
  });

  it("certifies the window's receipts-over-distance when the gates pass", () => {
    expect(assessMeasuredEfficiency({ distanceKm: "150", liters: "20", receipts: "4" }, 9)).toEqual({
      eligible: true,
      kmpl: 7.5,
      distance_km: 150,
      liters: 20,
      receipts: 4,
      profile_gap_ratio: Math.abs(7.5 - 9) / 9,
      flags: [],
    });
  });

  it("flags a large gap against the profile but never blocks on it", () => {
    const flagged = assessMeasuredEfficiency({ distanceKm: 150, liters: 30, receipts: 4 }, 9);
    expect(flagged.kmpl).toBe(5);
    expect(flagged.flags).toEqual(["profile-gap-high"]);

    // Exactly at the band edge is not a flag; only strictly beyond it is.
    const exactBand = assessMeasuredEfficiency({ distanceKm: 130, liters: 20, receipts: 3 }, 10);
    expect(exactBand.kmpl).toBe(6.5);
    expect(exactBand.profile_gap_ratio).toBeCloseTo(0.35);
    expect(exactBand.flags).toEqual([]);

    // No profile to compare against — no gap, no flag.
    const noProfile = assessMeasuredEfficiency({ distanceKm: 150, liters: 20, receipts: 4 }, null);
    expect(noProfile.eligible).toBe(true);
    expect(noProfile.profile_gap_ratio).toBeNull();
    expect(noProfile.flags).toEqual([]);
  });
});

describe("attachMeasuredEfficiency", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("aggregates the official caliber per vehicle and attaches the assessment", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("FROM fuelrecords")) return { rows: [{ vehicle_id: 3, liters: "20", receipts: 4 }] };
      if (sql.includes("FROM trips")) return { rows: [{ vehicle_id: 3, km: "150" }] };
      throw new Error(`unhandled: ${String(sql).slice(0, 80)}`);
    });
    const vehicles = [
      { vehicle_id: 3, fuel_efficiency_kmpl: "9" },
      { vehicle_id: 4, fuel_efficiency_kmpl: null },
    ];

    await attachMeasuredEfficiency(vehicles);

    expect(vehicles[0]._measured_efficiency).toMatchObject({ eligible: true, kmpl: 7.5 });
    expect(vehicles[1]._measured_efficiency).toMatchObject({ eligible: false });

    const [receiptSql, distanceSql] = query.mock.calls.map(([sql]) => sql);
    expect(receiptSql).toContain("ANY($1::int[])");
    expect(receiptSql).toContain("FROM fuelrecords");
    expect(receiptSql).toContain("deleted_at IS NULL");
    expect(receiptSql).toContain("status IN ('Approved', 'Completed')");
    expect(distanceSql).toContain("FROM trips");
    expect(distanceSql).toContain("trip_status = 'Completed'");
    expect(distanceSql).toContain("AT TIME ZONE 'Asia/Manila'");
  });

  it("does not query when there is nothing to attach", async () => {
    await attachMeasuredEfficiency([]);
    expect(query).not.toHaveBeenCalled();
  });
});
