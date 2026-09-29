import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import * as audit from "@/lib/audit";

afterEach(() => vi.restoreAllMocks());

const DRIVER = {
  driver_id: 7,
  first_name: "Sam",
  last_name: "Driver",
  license_number: "A12-34-567890",
  license_type: "Professional",
  license_class: "B",
  license_expiry: "2030-12-31",
  license_verified_at: "2026-09-26T12:00:00.000Z",
  license_verified_by: 2,
  license_verification_method: "physical_card",
};
const VEHICLE = { vehicle_id: 9, plate_number: "ABC-1234", required_license_class: "B" };

function setup({ driver = DRIVER, vehicle = VEHICLE, body = {} } = {}) {
  vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
  vi.spyOn(apiUtils, "parseBody").mockResolvedValue({
    vehicle_id: 9,
    substitute_driver_id: 7,
    effective_from: "2028-06-01",
    ...body,
  });
  vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM vehicles WHERE")) return { rows: vehicle ? [vehicle] : [] };
    if (sql.includes("FROM drivers d")) return { rows: driver ? [driver] : [] };
    if (sql.includes("FROM substitute_vehicle_schedules\n")) return { rows: [] };
    if (sql.includes("FROM substitute_vehicle_schedules s")) return { rows: [{ substitute_id: 44, ...driver, ...vehicle }] };
    return { rows: [] };
  });
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => fn({
    query: vi.fn().mockResolvedValue({ rows: [{ substitute_id: 44 }] }),
  }));
  vi.spyOn(audit, "writeAudit").mockResolvedValue();
}

describe("POST /api/substitute-driver-schedules license eligibility", () => {
  it("rejects a substitute whose license will be expired when coverage begins", async () => {
    setup({ driver: { ...DRIVER, license_expiry: "2028-05-31" } });

    const response = await POST({ json: async () => ({}) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Expired license");
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects a coverage range that extends beyond the license expiration date", async () => {
    setup({
      driver: { ...DRIVER, license_expiry: "2028-06-10" },
      body: { effective_until: "2028-06-11" },
    });

    const response = await POST({ json: async () => ({}) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("License expires before substitute coverage ends");
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("accepts verified class coverage through the expiration calendar day", async () => {
    setup({
      driver: { ...DRIVER, license_expiry: "2028-06-10" },
      body: { effective_until: "2028-06-10" },
    });

    const response = await POST({ json: async () => ({}) });

    expect(response.status).toBe(201);
    expect(db.withTransaction).toHaveBeenCalledOnce();
  });
});
