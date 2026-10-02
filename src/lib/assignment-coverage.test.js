import { describe, expect, it } from "vitest";
import { getFleetCustodyCoverage } from "@/lib/assignment-coverage";

describe("fleet custody coverage", () => {
  it("counts unique assigned vehicles that are in the active fleet denominator", () => {
    const result = getFleetCustodyCoverage(
      [
        { vehicle_id: 1, assigned_until: null },
        { vehicle_id: "1", assigned_until: null },
        { vehicle_id: 2, assigned_until: "2026-09-30" },
        { vehicle_id: 3, assigned_until: null },
        { vehicle_id: 5, assigned_until: null },
      ],
      [
        { vehicle_id: 1 },
        { vehicle_id: 2 },
        { vehicle_id: 3, deleted_at: "2026-09-30" },
        { vehicle_id: 4 },
        { vehicle_id: 5, vehicle_status: "Decommissioned" },
      ]
    );

    expect(result).toEqual({ assignedVehicles: 1, totalVehicles: 3, percent: 33 });
  });

  it("returns no percentage when there are no active vehicles", () => {
    expect(getFleetCustodyCoverage([{ vehicle_id: 1 }], [{ vehicle_id: 1, deleted_at: "archived" }])).toEqual({
      assignedVehicles: 0,
      totalVehicles: 0,
      percent: null,
    });
  });
});
