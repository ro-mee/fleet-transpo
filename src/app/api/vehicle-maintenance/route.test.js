import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn() }));
vi.mock("@/services/maintenance-schedule.service", () => ({ recomputeVehicleSchedule: vi.fn() }));

describe("POST /api/vehicle-maintenance", () => {
  let querySpy;
  let identitySpy;
  let mockInsertedRecord;

  beforeEach(() => {
    mockInsertedRecord = {
      maintenance_id: 1,
      vehicle_id: 1,
      status: "Scheduled",
      completed_by: null,
      completed_at: null
    };

    querySpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("INSERT INTO vehiclemaintenance")) {
        return { rows: [mockInsertedRecord] };
      }
      return { rows: [] };
    });
    vi.spyOn(db, "withTransaction").mockImplementation((callback) => callback({
      query: async (sql, values) => {
        if (sql.includes("set_config('statement_timeout'")) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO audit_logs")) return { rows: [{ log_id: 1 }], rowCount: 1 };
        return db.query(sql, values);
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockRequest(body, role = "fleet_manager", employeeId = 888) {
    identitySpy = vi.spyOn(utils, "requirePermission").mockResolvedValue({
      user: { role, employeeId },
    });
    return { json: async () => body };
  }

  function getInsertParams(queryCall) {
    const sql = queryCall[0];
    const values = queryCall[1];
    
    // Naively extract the columns list
    const colMatch = sql.match(/INSERT INTO vehiclemaintenance \((.*?)\)/);
    if (!colMatch) return {};
    
    const columns = colMatch[1].split(",").map(c => c.trim());
    const result = {};
    columns.forEach((col, i) => {
      result[col] = values[i];
    });
    return result;
  }

  it("Test 1: Normal POST", async () => {
    const req = mockRequest({ vehicle_id: 1, maintenance_date: "2026-08-30", maintenance_type: "Routine", cost: 100 });
    const res = await POST(req);
    const json = await res.json();
    
    expect(res.status).toBe(201);
    
    const insertCall = querySpy.mock.calls.find(c => c[0].includes("INSERT"));
    const params = getInsertParams(insertCall);
    
    expect(params.status).toBe("Scheduled");
    expect(params.completed_by).toBeUndefined(); // Should not be in the query
    expect(params.completed_at).toBeUndefined(); // Should not be in the query
  });

  it("Test 2: Client attempts Completed status", async () => {
    const req = mockRequest({ vehicle_id: 1, maintenance_date: "2026-08-30", maintenance_type: "Routine", status: "Completed" });
    const res = await POST(req);
    
    expect(res.status).toBe(201);
    
    const insertCall = querySpy.mock.calls.find(c => c[0].includes("INSERT"));
    const params = getInsertParams(insertCall);
    
    expect(params.status).toBe("Scheduled"); // Must be overridden
  });

  it("Test 3: Client attempts fake completion identity", async () => {
    const req = mockRequest({ vehicle_id: 1, maintenance_date: "2026-08-30", maintenance_type: "Routine", status: "Completed", completed_by: 99999 });
    const res = await POST(req);
    
    expect(res.status).toBe(201);
    
    const insertCall = querySpy.mock.calls.find(c => c[0].includes("INSERT"));
    const params = getInsertParams(insertCall);
    
    expect(params.status).toBe("Scheduled");
    expect(params.completed_by).toBeUndefined(); 
  });

  it("Test 4: Client attempts fake completion timestamp", async () => {
    const req = mockRequest({ vehicle_id: 1, maintenance_date: "2026-08-30", maintenance_type: "Routine", status: "Completed", completed_at: "2020-01-01T00:00:00Z" });
    const res = await POST(req);
    
    expect(res.status).toBe(201);
    
    const insertCall = querySpy.mock.calls.find(c => c[0].includes("INSERT"));
    const params = getInsertParams(insertCall);
    
    expect(params.status).toBe("Scheduled");
    expect(params.completed_at).toBeUndefined();
  });

  it("Test 5: Combined spoofing attack", async () => {
    const req = mockRequest({ 
      vehicle_id: 1, 
      maintenance_date: "2026-08-30", 
      maintenance_type: "Routine",
      status: "Completed", 
      completed_by: 99999, 
      completed_at: "2020-01-01T00:00:00Z" 
    });
    const res = await POST(req);
    
    expect(res.status).toBe(201);
    
    const insertCall = querySpy.mock.calls.find(c => c[0].includes("INSERT"));
    const params = getInsertParams(insertCall);
    
    expect(params.status).toBe("Scheduled");
    expect(params.completed_by).toBeUndefined();
    expect(params.completed_at).toBeUndefined();
  });
});

describe("GET /api/vehicle-maintenance overdue scope", () => {
  it("marks past scheduled records as overdue without changing their stored status", async () => {
    const record = { maintenance_id: 17, status: "Scheduled", is_overdue: true };
    const querySpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("AS is_overdue")) return { rows: [record] };
      if (sql.includes("AS overdue")) return { rows: [{ total: "2", scheduled: "2", overdue: "1", inProgress: "0", total_cost: "0" }] };
      if (sql.includes("count(*) AS total")) return { rows: [{ total: "2" }] };
      return { rows: [] };
    });
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "fleet_manager" } });

    const response = await GET(new Request("https://fleet.test/api/vehicle-maintenance?page=1&pageSize=10"));
    const body = await response.json();
    const listSql = querySpy.mock.calls.find(([sql]) => sql.includes("AS is_overdue"))[0];

    expect(body.counts.overdue).toBe(1);
    expect(body.rows[0]).toMatchObject({ status: "Scheduled", is_overdue: true });
    expect(listSql).toContain("NOW() AT TIME ZONE 'Asia/Manila'");
    expect(listSql).toContain("vm.maintenance_date <");
  });
});
