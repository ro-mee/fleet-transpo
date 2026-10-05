import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST, GET } from "./route";
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

// Task 4 — mechanic scoped reads. The query mock below plays the database:
// it honors an `assigned_mechanic_id = $n` predicate when the route's SQL
// carries one, and it projects columns the way Postgres would — full rows
// (with purchase_price / image_url) only when the SQL asks for `vm.*` or
// `row_to_json`, lean rows otherwise. So a route that forgets the filter
// leaks other mechanics' rows, and a route that selects the fat projection
// leaks purchase_price / image_url, exactly as production would.
describe("GET /api/vehicle-maintenance mechanic scoping (Task 4)", () => {
  let mechQuerySpy;
  beforeEach(() => {
    mechQuerySpy = vi.spyOn(db, "query");
    stubMaintenanceGet();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const EVIDENCE_KEYS = [
    "assigned_at",
    "repair_started_at",
    "repair_completed_at",
    "repair_completed_by",
    "diagnosis",
    "parts_replaced",
    "labor_hours",
    "rejection_reason",
    "completed_date",
  ];

  const WO_ROW = (over = {}) => ({
    maintenance_id: 11,
    vehicle_id: 1,
    maintenance_type: "Brake Repair",
    maintenance_date: "2026-10-01",
    completed_date: "2026-10-04",
    status: "Scheduled",
    priority: "High",
    cost: "1500",
    service_provider: "Shop",
    service_center: "Center",
    mileage_at_service: "10000",
    description: "worn pads",
    remarks: "r1",
    created_at: "2026-10-01T00:00:00.000Z",
    source_incident_id: null,
    source_inspection_id: 42,
    assigned_mechanic_id: 77,
    assigned_at: "2026-10-01T08:00:00.000Z",
    repair_started_at: "2026-10-02T08:00:00.000Z",
    repair_completed_at: null,
    repair_completed_by: null,
    diagnosis: "worn pads",
    parts_replaced: ["pad set"],
    labor_hours: "1.5",
    rejection_reason: null,
    purchase_price: "500000",
    image_url: "http://img/1.jpg",
    vehicles: { plate_number: "ABC 1", vehicle_name: "Van 1", purchase_price: "500000", image_url: "http://img/1.jpg" },
    ...over,
  });

  const MIXED = [
    WO_ROW(),
    WO_ROW({ maintenance_id: 12, assigned_mechanic_id: 78 }),
    WO_ROW({ maintenance_id: 13, assigned_mechanic_id: null }),
  ];

  function stubMaintenanceGet() {
    mechQuerySpy.mockImplementation(async (sql, params = []) => {
      if (sql.includes("total_cost")) {
        return { rows: [{ total: "1", scheduled: "1", inProgress: "0", total_cost: "1500" }] };
      }
      if (sql.includes("count(*) AS total")) {
        return { rows: [{ total: "1" }] };
      }
      const scoped = /vm\.assigned_mechanic_id = \$(\d+)/.exec(sql);
      let rows = scoped
        ? MIXED.filter((r) => r.assigned_mechanic_id === params[Number(scoped[1]) - 1])
        : [...MIXED];
      const lean = !sql.includes("vm.*") && !sql.includes("row_to_json")
        && !sql.includes("purchase_price") && !sql.includes("image_url");
      if (lean) {
        const selectsAssignment = sql.includes("assigned_mechanic_id");
        rows = rows.map((r) => {
          const out = {};
          for (const [k, v] of Object.entries(r)) {
            if (k === "purchase_price" || k === "image_url") continue;
            if (k === "assigned_mechanic_id" && !selectsAssignment) continue;
            // Task 4b: evidence columns only reach the row when the lean
            // projection selects them — exactly as Postgres would.
            if (EVIDENCE_KEYS.includes(k) && !sql.includes(`vm.${k}`)) continue;
            if (k === "source_inspection_id" && !sql.includes("vm.source_inspection_id")) continue;
            if (k === "vehicles") {
              out.vehicles = { plate_number: v.plate_number, vehicle_name: v.vehicle_name };
              continue;
            }
            out[k] = v;
          }
          return out;
        });
      }
      return { rows };
    });
  }

  function getReq(url, role = "mechanic", employeeId = 77) {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role, employeeId } });
    return { url };
  }

  function listSqls() {
    return mechQuerySpy.mock.calls
      .map((c) => c[0])
      .filter((sql) => !sql.includes("count(*)") && !sql.includes("total_cost"));
  }

  it("paginated: a mechanic sees only their own rows through the lean projection", async () => {
    stubMaintenanceGet();
    const res = await GET(getReq("http://test/api/vehicle-maintenance?page=1&pageSize=10"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(row.assigned_mechanic_id).toBe(77);
    }
    expect(JSON.stringify(body)).not.toContain("purchase_price");
    expect(JSON.stringify(body)).not.toContain("image_url");

    // Every statement the branch issued is scoped to the caller.
    for (const [sql, params] of mechQuerySpy.mock.calls) {
      expect(sql).toContain("vm.assigned_mechanic_id = $");
      expect(params).toContain(77);
    }
    for (const sql of listSqls()) {
      expect(sql).not.toContain("vm.*");
      expect(sql).not.toContain("row_to_json");
      expect(sql).not.toContain("purchase_price");
      expect(sql).not.toContain("image_url");
    }
  });

  it("non-paginated: a mechanic still gets only their own rows, still lean", async () => {
    stubMaintenanceGet();
    const res = await GET(getReq("http://test/api/vehicle-maintenance"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(row.assigned_mechanic_id).toBe(77);
    }
    expect(JSON.stringify(body)).not.toContain("purchase_price");
    expect(JSON.stringify(body)).not.toContain("image_url");
    for (const sql of listSqls()) {
      expect(sql).toContain("vm.assigned_mechanic_id = $");
      expect(sql).not.toContain("vm.*");
      expect(sql).not.toContain("row_to_json");
    }
  });

  it("staff register behavior is unchanged: no assignee filter, unscoped counts", async () => {
    stubMaintenanceGet();
    const res = await GET(getReq("http://test/api/vehicle-maintenance?page=1&pageSize=10", "fleet_manager", 888));
    expect(res.status).toBe(200);
    const body = await res.json();

    // All three rows, including other mechanics' and unassigned.
    expect(body.rows).toHaveLength(3);
    for (const [sql] of mechQuerySpy.mock.calls) {
      expect(sql).not.toContain("assigned_mechanic_id");
    }
    const countsCall = mechQuerySpy.mock.calls.find((c) => c[0].includes("total_cost"));
    expect(countsCall[1]).toBeUndefined();
  });

  it("Task 4b: mechanic lean rows carry the 9 evidence keys + source_inspection_id", async () => {
    stubMaintenanceGet();
    const res = await GET(getReq("http://test/api/vehicle-maintenance?page=1&pageSize=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      for (const key of EVIDENCE_KEYS) {
        expect(row, `mechanic row missing ${key}`).toHaveProperty(key);
      }
      expect(row).toHaveProperty("source_inspection_id");
      expect(Array.isArray(row.parts_replaced)).toBe(true);
    }
    for (const sql of listSqls()) {
      for (const key of EVIDENCE_KEYS) {
        expect(sql).toContain(`vm.${key}`);
      }
      expect(sql).toContain("vm.source_inspection_id");
    }
  });

  it("Task 4b: staff lean rows carry the same evidence superset (still no assigned_mechanic_id)", async () => {
    stubMaintenanceGet();
    const res = await GET(getReq("http://test/api/vehicle-maintenance?page=1&pageSize=10", "fleet_manager", 888));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(3);
    for (const row of body.rows) {
      for (const key of EVIDENCE_KEYS) {
        expect(row, `staff row missing ${key}`).toHaveProperty(key);
      }
      expect(row).toHaveProperty("source_inspection_id");
    }
    for (const sql of listSqls()) {
      expect(sql).not.toContain("assigned_mechanic_id");
      for (const key of EVIDENCE_KEYS) {
        expect(sql).toContain(`vm.${key}`);
      }
    }
  });
});
