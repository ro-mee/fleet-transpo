import { describe, expect, it } from "vitest";
import { getFleetCustodyCoverage, getRelativeAssignedDuration, getScheduleStatus } from "@/lib/assignment-coverage";

describe("substitute schedule Philippine dates", () => {
  it("counts custody age by Philippine calendar days before 08:00", () => {
    expect(getRelativeAssignedDuration("2026-10-25", new Date("2026-10-25T16:30:00Z"))).toBe("1 day active");
    expect(getRelativeAssignedDuration("2026-10-26", new Date("2026-10-25T16:30:00Z"))).toBe("Assigned today");
  });
  it("marks coverage active from Philippine midnight while UTC is still yesterday", () => {
    expect(getScheduleStatus({ effective_from: "2026-10-26", effective_until: "2026-10-26" }, new Date("2026-10-25T16:30:00Z")))
      .toMatchObject({ label: "Active Today", activeToday: true });
  });

  it("expires coverage at the next Philippine midnight and keeps future open coverage upcoming", () => {
    const reference = new Date("2026-10-25T16:30:00Z");
    expect(getScheduleStatus({ effective_from: "2026-10-24", effective_until: "2026-10-25" }, reference))
      .toMatchObject({ label: "Expired", activeToday: false });
    expect(getScheduleStatus({ effective_from: "2026-10-27", effective_until: null }, reference))
      .toMatchObject({ label: "Upcoming", activeToday: false });
  });
});

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
