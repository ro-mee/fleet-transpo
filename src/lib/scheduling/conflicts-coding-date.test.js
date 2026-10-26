import { afterEach, expect, it, vi } from "vitest";
import * as db from "@/lib/db";
import * as coding from "@/lib/uvvrp/uvvrp.service";
import * as cargo from "@/services/cargo-physical.service";
import * as settings from "@/services/dispatch-settings.service";
import { detectConflictsForRequests, detectRequestConflicts } from "./conflicts";
import { CONFLICT_TYPE } from "./conflict-types";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(cargo, "loadCargoPhysicalAssessments").mockResolvedValue({ results: new Map() });
  vi.spyOn(cargo, "loadCargoPhysicalBatch").mockResolvedValue(new Map());
  vi.spyOn(settings, "getDispatchPolicy").mockResolvedValue(null);
  vi.spyOn(db, "query").mockImplementation(async (sql) => ({ rows: sql.includes("FROM vehicles")
    ? [{ vehicle_id: 1, plate_number: "ABC-1231", vehicle_status: "Available", registration_expiry: "2030-01-01", insurance_expiry: "2030-01-01" }]
    : [] }));
  vi.spyOn(coding, "getUvvrpPolicy").mockResolvedValue({ enabled: true, response: "block", weekdayRestrictions: { Monday: [1], Tuesday: [1] } });
  vi.spyOn(coding, "getExemptVehicleIds").mockImplementation(async (date) => date === "2026-10-26" || date === "2026-10-25T16:30:00Z" ? new Set([1]) : new Set());
}

it("applies an approved pass only to its departure day in the queue batch", async () => {
  setup();
  const result = await detectConflictsForRequests([
    { request_id: 1, vehicle_id: 1, pickup_datetime: "2026-10-25T16:30:00Z" },
    { request_id: 2, vehicle_id: 1, pickup_datetime: "2026-10-26T16:30:00Z" },
  ]);
  expect(result.get(1).some((finding) => finding.type === CONFLICT_TYPE.UVVRP_RESTRICTED)).toBe(false);
  expect(result.get(2).some((finding) => finding.type === CONFLICT_TYPE.UVVRP_RESTRICTED)).toBe(true);
});

it("uses the departure date for single-request coding findings", async () => {
  setup();
  const result = await detectRequestConflicts({ request_id: 1, vehicle_id: 1, pickup_datetime: "2026-10-25T16:30:00Z" });
  expect(result.some((finding) => finding.type === CONFLICT_TYPE.UVVRP_RESTRICTED)).toBe(false);
});
