import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/db";
import { evaluateCoding, getBoardData, getExemptVehicleIds, loadDriverTravelContext, loadVehicleTravelContext } from "./uvvrp.service";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const policy = { enabled: true, weekdayRestrictions: { Monday: [1], Tuesday: [3] } };
const vehicle = { vehicle_id: 1, plate_number: "ABC-1231", vehicle_status: "Available" };

function stubDatabase({ exemptions = [], storedPolicy = policy } = {}) {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM system_settings")) return { rows: [{ setting_value: storedPolicy }] };
    if (sql.includes("FROM uvvrp_exemptions")) return { rows: exemptions };
    if (sql.includes("FROM vehicles WHERE deleted_at")) return { rows: [vehicle] };
    return { rows: [] };
  });
}

describe("UVVRP Philippine calendar", () => {
  it("starts today's board on the Philippine date before 08:00", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T16:30:00Z"));
    stubDatabase();
    const board = await getBoardData();
    expect(board.weekday).toBe("Monday");
    expect(board.restrictedToday.map((row) => row.vehicle_id)).toEqual([1]);
    expect(board.upcoming.map(({ date }) => date)).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
  });

  it("stops counting a pass after its expiry within the seven-day forecast", async () => {
    stubDatabase({
      exemptions: [{ vehicle_id: 1, active: true, expires_on: "2026-10-26" }],
      storedPolicy: { ...policy, weekdayRestrictions: { Monday: [1], Tuesday: [1] } },
    });
    const board = await getBoardData({ date: "2026-10-26" });
    expect(board.restrictedToday[0].exempt).toBe(true);
    expect(board.upcoming[1]).toMatchObject({ date: "2026-10-27", restrictedCount: 1 });
  });

  it("matches an approved departure using the Philippine day in both query operands", async () => {
    const query = stubDatabase();
    await evaluateCoding({ vehicleId: 1, plateNumber: vehicle.plate_number, scheduledDeparture: "2026-10-25T16:30:00Z" });
    const approval = query.mock.calls.find(([sql]) => sql.includes("SELECT violation_id FROM uvvrp_violations"));
    expect(approval?.[0]).toContain("scheduled_departure AT TIME ZONE 'Asia/Manila'");
    expect(approval?.[1]).toEqual([1, "2026-10-26"]);
  });

  it("loads substitute coverage for the Philippine departure date", async () => {
    const query = stubDatabase();
    await loadVehicleTravelContext("2026-10-25T16:30:00Z");
    const coverage = query.mock.calls.find(([sql]) => sql.includes("FROM substitute_vehicle_schedules"));
    expect(coverage?.[1]).toEqual(["2026-10-26"]);
  });

  it("limits picker passes to the requested Philippine day while retaining permanent exemptions", async () => {
    const query = stubDatabase({ exemptions: [{ vehicle_id: 5, active: true, expires_on: null }] });
    expect(await getExemptVehicleIds("2026-10-25T16:30:00Z")).toEqual(new Set([5]));
    const approvals = query.mock.calls.find(([sql]) => sql.includes("SELECT DISTINCT vehicle_id FROM uvvrp_violations"));
    expect(approvals?.[0]).toContain("scheduled_departure AT TIME ZONE 'Asia/Manila'");
    expect(approvals?.[1]).toEqual(["2026-10-26"]);
    const exemptions = query.mock.calls.find(([sql]) => sql.includes("FROM uvvrp_exemptions"));
    expect(exemptions?.[1]).toEqual(["2026-10-26"]);
  });

  it.each([loadDriverTravelContext, loadVehicleTravelContext])("scopes travel-context exemptions to departure, not today (%#)", async (load) => {
    const query = stubDatabase();
    await load("2026-11-02T00:30:00+08:00");
    const approvals = query.mock.calls.find(([sql]) => sql.includes("SELECT DISTINCT vehicle_id FROM uvvrp_violations"));
    expect(approvals?.[1]).toEqual(["2026-11-02"]);
  });
});
