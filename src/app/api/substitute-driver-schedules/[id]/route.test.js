import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => null) }));

afterEach(() => vi.restoreAllMocks());

const DRIVER = {
  driver_type: "Passenger",
  operational_use: "Passenger",
  license_number: "A12-34-567890",
  license_type: "Professional",
  license_class: "B",
  license_expiry: "2028-05-31",
  license_verified_at: "2026-09-26T12:00:00.000Z",
  license_verified_by: 2,
  license_verification_method: "physical_card",
  required_license_class: "B",
};

describe("PATCH /api/substitute-driver-schedules/[id] license eligibility", () => {
  it("rejects updating coverage when the substitute license expires before the new start", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
    vi.spyOn(apiUtils, "parseBody").mockResolvedValue({ effective_from: "2028-06-01" });
    const query = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM substitute_vehicle_schedules s")) {
        return { rows: [{ substitute_id: 12, vehicle_id: 9, substitute_driver_id: 7, effective_from: "2028-05-01", effective_until: null }] };
      }
      if (sql.includes("FROM drivers d")) return { rows: [DRIVER] };
      return { rows: [] };
    });

    const response = await PATCH(
      { url: "http://x/api/substitute-driver-schedules/12", json: async () => ({}) },
      { params: Promise.resolve({ id: "12" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Expired license");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE substitute_vehicle_schedules"))).toBe(false);
  });

  it("refuses a Passenger substitute on a Cargo vehicle", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
    vi.spyOn(apiUtils, "parseBody").mockResolvedValue({ effective_from: "2028-06-01" });
    const query = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM substitute_vehicle_schedules s")) {
        return { rows: [{ substitute_id: 12, vehicle_id: 9, substitute_driver_id: 7, effective_from: "2028-05-01", effective_until: null }] };
      }
      if (sql.includes("FROM drivers d")) return { rows: [{ ...DRIVER, driver_type: "Passenger", operational_use: "Cargo", license_expiry: "2030-12-31" }] };
      if (sql.includes("UPDATE substitute_vehicle_schedules")) return { rows: [{ substitute_id: 12 }] };
      return { rows: [] };
    });

    const response = await PATCH(
      { url: "http://x/api/substitute-driver-schedules/12", json: async () => ({}) },
      { params: Promise.resolve({ id: "12" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/classification does not match/i);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE substitute_vehicle_schedules"))).toBe(false);
  });

  it("re-normalizes unchanged dates to calendar-day keys instead of re-binding pg Date objects", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
    vi.spyOn(apiUtils, "parseBody").mockResolvedValue({ notes: "Same coverage, reworded" });
    const query = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM substitute_vehicle_schedules s")) {
        // pg pins `date` columns to JS Date objects at local midnight.
        return { rows: [{ substitute_id: 12, vehicle_id: 9, substitute_driver_id: 7, effective_from: new Date(2026, 5, 1), effective_until: null }] };
      }
      if (sql.includes("FROM drivers d")) return { rows: [DRIVER] };
      if (sql.includes("UPDATE substitute_vehicle_schedules")) return { rows: [{ substitute_id: 12 }] };
      return { rows: [] };
    });

    const response = await PATCH(
      { url: "http://x/api/substitute-driver-schedules/12", json: async () => ({}) },
      { params: Promise.resolve({ id: "12" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const updateParams = query.mock.calls.find(([sql]) => sql.includes("UPDATE substitute_vehicle_schedules"))[1];
    // A rebound Date would shift the unchanged schedule one day back on the DB's UTC session.
    expect(updateParams[2]).toBe("2026-06-01");
    expect(updateParams[3]).toBeNull();
    expect(body.schedule.effective_from).toBe("2026-06-01");
  });
});
