import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import * as audit from "@/lib/audit";

afterEach(() => vi.restoreAllMocks());

function request(body) {
  return { url: "http://x/api/driver-assignments", json: async () => body };
}

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
const VEHICLE = {
  vehicle_id: 9,
  plate_number: "ABC-1234",
  vehicle_status: "Available",
  required_license_class: "B",
};

function setup({ driver = DRIVER, vehicle = VEHICLE } = {}) {
  vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
  vi.spyOn(apiUtils, "parseBody").mockResolvedValue({ driver_id: 7, vehicle_id: 9 });
  vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM drivers d")) return { rows: driver ? [driver] : [] };
    if (sql.includes("FROM vehicles WHERE")) return { rows: vehicle ? [vehicle] : [] };
    if (sql.includes("FROM driver_vehicle_assignments")) return { rows: [] };
    if (sql.includes("RETURNING assignment_id")) return { rows: [{ assignment_id: 71 }] };
    return { rows: [] };
  });
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => fn({
    query: vi.fn().mockResolvedValue({ rows: [{ assignment_id: 71 }] }),
  }));
  vi.spyOn(audit, "writeAudit").mockResolvedValue();
}

describe("POST /api/driver-assignments license eligibility", () => {
  it("rejects an expired license before opening a custodial pairing", async () => {
    setup({ driver: { ...DRIVER, license_expiry: "2026-09-26" } });

    const response = await POST(request({ driver_id: 7, vehicle_id: 9 }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Expired license");
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects a license class that does not cover the vehicle", async () => {
    setup({ vehicle: { ...VEHICLE, required_license_class: "B1" } });

    const response = await POST(request({ driver_id: 7, vehicle_id: 9 }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("License class does not cover this vehicle");
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("allows a verified eligible pairing", async () => {
    setup();

    const response = await POST(request({ driver_id: 7, vehicle_id: 9 }));

    expect(response.status).toBe(201);
    expect(db.withTransaction).toHaveBeenCalledOnce();
  });
});
