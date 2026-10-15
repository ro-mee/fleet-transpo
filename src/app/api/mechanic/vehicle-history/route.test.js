import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { requirePermission } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { GET } from "./route";

const req = (url = "http://test/api/mechanic/vehicle-history?vehicle_id=12") => new Request(url);

const MAINT = (over = {}) => ({
  maintenance_id: 7,
  maintenance_type: "Brake Service",
  maintenance_date: "2026-10-01",
  completed_date: "2026-10-02",
  status: "Completed",
  priority: "High",
  diagnosis: "worn pads",
  parts_replaced: [{ name: "Brake pad set", qty: 1 }],
  ...over,
});

const INCIDENT = (over = {}) => ({
  incident_id: 3,
  incident_type: "Brake Failure",
  incident_date: "2026-09-20T08:00:00.000Z",
  severity: "Major",
  status: "Resolved",
  ...over,
});

const INSPECTION = (over = {}) => ({
  inspection_id: 31,
  inspection_type: "Post-Shift",
  inspection_date: "2026-09-25",
  status: "Reported",
  severity: "Minor",
  findings_excerpt: "grinding noise",
  ...over,
});

// Plays the database: the gate answers from `owned`, every list returns one
// canned row, and the PMS/vehicle pair is configurable per test.
function stubHistory({ owned = true, pms = { maintenance_id: 5, maintenance_type: "Routine", maintenance_date: "2026-08-01", completed_date: "2026-08-02" }, vehicleDate = "2026-08-02" } = {}) {
  query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes("assigned_mechanic_id = $2")) return { rows: owned ? [{ "1": 1 }] : [] };
    if (text.includes("maintenance_type = 'Routine'")) return { rows: pms ? [pms] : [] };
    if (text.includes("FROM vehicles")) return { rows: [{ last_service_date: vehicleDate }] };
    if (text.includes("FROM driverincidents")) return { rows: [INCIDENT()] };
    if (text.includes("FROM vehicleinspection")) return { rows: [INSPECTION()] };
    if (text.includes("FROM vehiclemaintenance")) return { rows: [MAINT()] };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mechanic/vehicle-history (P1b)", () => {
  it("refuses a non-mechanic with 403 without querying", async () => {
    requirePermission.mockResolvedValue({ user: { role: "fleet_manager", employeeId: 8 } });
    stubHistory();
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-numeric vehicle_id with 400", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubHistory();
    for (const url of [
      "http://test/api/mechanic/vehicle-history",
      "http://test/api/mechanic/vehicle-history?vehicle_id=abc",
      "http://test/api/mechanic/vehicle-history?vehicle_id=-4",
    ]) {
      const res = await GET(req(url));
      expect(res.status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a vehicle the mechanic has no assigned work order on (403, fail-closed)", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubHistory({ owned: false });
    const res = await GET(req());
    expect(res.status).toBe(403);
    // The gate is the only statement that runs — no list leaks past it.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([12, 77]);
    expect(query.mock.calls[0][0]).toContain("vehicle_id = $1");
    expect(query.mock.calls[0][0]).toContain("assigned_mechanic_id = $2");
  });

  it("returns lean history for an assigned vehicle, with no cost anywhere", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubHistory();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["incidents", "inspections", "lastPms", "maintenance"]);
    expect(body.maintenance).toHaveLength(1);
    expect(Object.keys(body.maintenance[0]).sort()).toEqual([
      "completed_date", "diagnosis", "maintenance_date", "maintenance_id",
      "maintenance_type", "parts_replaced", "priority", "status",
    ]);
    expect(body.incidents[0]).toMatchObject({ incident_id: 3, severity: "Major", status: "Resolved" });
    expect(body.inspections[0]).toMatchObject({ inspection_id: 31, findings_excerpt: "grinding noise" });
    expect(body.lastPms).toMatchObject({ maintenance_id: 5, source: "routine-record" });

    // Cost must not appear in the payload at all, and no statement selects it.
    expect(JSON.stringify(body)).not.toMatch(/cost/i);
    for (const [sql] of query.mock.calls) {
      expect(String(sql).toLowerCase()).not.toContain("cost");
    }
    const listQueries = query.mock.calls.filter(([sql]) => /FROM (vehiclemaintenance vm|driverincidents i|vehicleinspection i)/.test(sql) && !sql.includes("maintenance_type = 'Routine'"));
    expect(listQueries).toHaveLength(3);
    for (const [sql, params] of listQueries) {
      expect(sql).toMatch(/(?:vm|i)\.vehicle_id = \$1/);
      expect(sql).toContain("LIMIT 5");
      expect(params).toEqual([12]);
    }
  });

  it("falls back to the vehicle last_service_date when no Completed Routine row exists", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubHistory({ pms: null, vehicleDate: "2026-07-15" });
    const res = await GET(req());
    const body = await res.json();
    expect(body.lastPms).toMatchObject({
      maintenance_id: null,
      maintenance_date: "2026-07-15",
      source: "vehicle.last_service_date",
    });
  });

  it("returns a null lastPms when neither source has a date", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubHistory({ pms: null, vehicleDate: null });
    const res = await GET(req());
    const body = await res.json();
    expect(body.lastPms).toBeNull();
  });
});
