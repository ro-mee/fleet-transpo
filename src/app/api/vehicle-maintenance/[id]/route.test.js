import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PUT } from "./route";
import * as db from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import * as utils from "@/lib/api/utils";
import * as statusService from "@/services/status.service";
import * as pushService from "@/services/push.service";
import * as maintenanceScheduleService from "@/services/maintenance-schedule.service";

vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn() }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn() }));
vi.mock("@/services/maintenance-schedule.service", () => ({ recomputeVehicleSchedule: vi.fn() }));

describe("PUT /api/vehicle-maintenance/[id]", () => {
  const maintenanceId = 123;
  let querySpy;
  let identitySpy;
  let mockRecord;

  beforeEach(() => {
    mockRecord = {
      maintenance_id: maintenanceId,
      vehicle_id: 1,
      status: "Scheduled",
      completed_by: null,
      completed_at: null
    };

    querySpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status FROM vehiclemaintenance")) {
        return { rows: [mockRecord] };
      }
      if (sql.includes("UPDATE vehiclemaintenance")) {
        return { rows: [mockRecord] };
      }
      if (sql.includes("SELECT e.employee_id")) {
        return { rows: [{ employee_id: 999 }] };
      }
      if (sql.includes("SELECT plate_number FROM vehicles")) {
        return { rows: [{ plate_number: "ABC-123" }] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockRequest(body, role = "fleet_manager", employeeId = 888) {
    identitySpy = vi.spyOn(utils, "requirePermission").mockResolvedValue({
      user: { role, employeeId, roles: { role_name: role } },
    });
    return { json: async () => body };
  }

  it("Test 1: Scheduled → In Progress (completed_by remains NULL)", async () => {
    mockRecord.status = "Scheduled"; // Before status
    
    // Setup the mock to return the updated status
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Scheduled" }] };
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "In Progress" }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "In Progress" });
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("In Progress");
    expect(json.completed_by).toBeFalsy();
    
    // Verify query was called but without completed_by
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).not.toContain("completed_by");
  });

  it("Test 2 & 3: Scheduled/In Progress → Completed (sets completed_by and completed_at)", async () => {
    mockRecord.status = "In Progress"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "In Progress" }] };
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed", completed_by: values[values.length - 1] }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Completed", cost: 100 }, "fleet_manager", 777);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("Completed");
    expect(json.completed_by).toBe(777);

    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).toContain("completed_by = $");
    expect(updateCall[0]).toContain("completed_at = CURRENT_TIMESTAMP");
  });

  it("Test 4 & 5: Completed → Scheduled/In Progress (BLOCKED)", async () => {
    mockRecord.status = "Completed"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Completed" }] };
      return { rows: [] }; // UPDATE should not be called
    });

    let req = mockRequest({ status: "Scheduled" });
    let res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(409);
    
    req = mockRequest({ status: "In Progress" });
    res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(409);
    
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall).toBeUndefined(); // Ensure UPDATE was never executed
  });

  it("Test 6: Completed → Completed (TERMINAL)", async () => {
    mockRecord.status = "Completed"; 
    mockRecord.completed_by = 123;
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Completed" }] };
      if (sql.includes("UPDATE")) return { rows: [mockRecord] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Completed", cost: 500 }, "fleet_manager", 888);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);
    
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    // Ensure it didn't inject completed_by
    expect(updateCall[0]).not.toContain("completed_by = $");
  });

  it("Test 7: Client Spoofing", async () => {
    mockRecord.status = "Scheduled"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Scheduled" }] };
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed", completed_by: values[values.length - 1] }] };
      return { rows: [] };
    });

    const req = mockRequest({ 
      status: "Completed", 
      completed_by: 99999, // Fake
      completed_at: "2020-01-01T00:00:00Z" // Fake
    }, "fleet_manager", 555);
    
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("Completed");
    expect(json.completed_by).toBe(555); // Overridden by server auth

    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).toContain("completed_by = $");
    // The fake completed_by is stripped because it's not in FIELD_TO_COLUMN.
    // Ensure the query uses session employeeId
    expect(updateCall[1]).toContain(555); 
    expect(updateCall[1]).not.toContain(99999);
  });

  it("Test 8: Unauthorized User", async () => {
    const req = mockRequest({ status: "Completed" }, "driver", 123);
    
    vi.spyOn(utils, "requirePermission").mockRejectedValue(new AuthError("Unauthorized", 403));
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(403);
  });
});
