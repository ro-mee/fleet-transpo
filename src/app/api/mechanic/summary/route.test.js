import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { requirePermission, AuthError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { GET } from "./route";

const req = (url = "http://test/api/mechanic/summary") => new Request(url);

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

const WO = (over = {}) => ({
  maintenance_id: 5,
  vehicle_id: 1,
  maintenance_type: "Brake Repair",
  maintenance_date: "2026-10-03",
  completed_date: null,
  status: "In Progress",
  priority: "High",
  diagnosis: "worn pads",
  parts_replaced: ["pad set"],
  labor_hours: "1.5",
  rejection_reason: null,
  assigned_at: "2026-10-03T08:00:00.000Z",
  repair_started_at: "2026-10-03T09:00:00.000Z",
  repair_completed_at: null,
  repair_completed_by: null,
  source_inspection_id: 42,
  ageMinutes: 90,
  vehicle: { plate_number: "ABC 1234", vehicle_name: "HiAce" },
  ...over,
});

// Plays the database: counts come back as pg bigint strings (so the route
// must coerce to numbers), the queue carries the Task 6 row shape, and the
// attention rows carry the notification columns.
function stubSummary({ queueRows = [WO(), WO({ maintenance_id: 6, status: "Scheduled", priority: "Normal" })] } = {}) {
  query.mockImplementation(async (sql) => {
    if (String(sql).includes("FROM notifications")) {
      return {
        rows: [{
          id: 9,
          title: "Work assigned",
          message: "New job on Van 1",
          type: "Info",
          reference_type: "maintenance",
          reference_id: 5,
          created_at: "2026-10-05T08:00:00.000Z",
          is_read: false,
        }],
      };
    }
    if (/COUNT\(\*\)\s+AS\s+assigned/.test(String(sql))) {
      return { rows: [{ assigned: "3", inProgress: "1", waitingApproval: "1", urgent: "2", overdue: "1" }] };
    }
    return { rows: queueRows };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mechanic/summary (Task 4)", () => {
  it("refuses a non-mechanic with 403 without querying", async () => {
    requirePermission.mockResolvedValue({ user: { role: "fleet_manager", employeeId: 8 } });
    stubSummary();
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the Task 6 payload shape for the assigned mechanic", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubSummary();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["attention", "counts", "queue", "upNext", "upcoming"]);
    expect(body.counts).toEqual({ assigned: 3, inProgress: 1, waitingApproval: 1, urgent: 2, overdue: 1 });

    // upNext is the head of the queue: same row shape, identical content.
    expect(body.upNext).toEqual(body.queue[0]);
    for (const row of [body.upNext, ...body.queue]) {
      expect(Object.keys(row).sort()).toEqual([
        "ageMinutes", "assigned_at", "completed_date", "diagnosis",
        "labor_hours", "maintenance_date", "maintenance_id",
        "maintenance_type", "parts_replaced", "priority",
        "rejection_reason", "repair_completed_at", "repair_completed_by",
        "repair_started_at", "source_inspection_id",
        "status", "vehicle", "vehicle_id",
      ]);
      for (const key of EVIDENCE_KEYS) {
        expect(row, `summary row missing ${key}`).toHaveProperty(key);
      }
      expect(Array.isArray(row.parts_replaced)).toBe(true);
      expect(Object.keys(row.vehicle).sort()).toEqual(["plate_number", "vehicle_name"]);
    }
    // Task 4b: the queue SQL carries the evidence columns so the rows above
    // are real projections, not JS defaults. (Counts SQL also reads
    // vehiclemaintenance but projects aggregates only — excluded here.)
    for (const [sql] of query.mock.calls) {
      if (!String(sql).includes("maintenance_id")) continue;
      for (const key of EVIDENCE_KEYS) {
        expect(String(sql)).toContain(key);
      }
      expect(String(sql)).toContain("source_inspection_id");
    }
    expect(body.upNext).toMatchObject({
      maintenance_id: 5,
      vehicle_id: 1,
      maintenance_type: "Brake Repair",
      maintenance_date: "2026-10-03",
      status: "In Progress",
      priority: "High",
      diagnosis: "worn pads",
      ageMinutes: 90,
      vehicle: { plate_number: "ABC 1234", vehicle_name: "HiAce" },
    });

    expect(body.attention).toEqual([{
      id: 9,
      title: "Work assigned",
      message: "New job on Van 1",
      type: "Info",
      reference_type: "maintenance",
      reference_id: 5,
      created_at: "2026-10-05T08:00:00.000Z",
      is_read: false,
    }]);
    expect(body.upcoming).toEqual([]);

    // Every statement the route issued is scoped to the caller.
    expect(query).toHaveBeenCalled();
    for (const [, params] of query.mock.calls) {
      expect(params).toContain(77);
    }
  });

  it("answers upNext null on an empty queue", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubSummary({ queueRows: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upNext).toBeNull();
    expect(body.queue).toEqual([]);
  });

  it("counts ALL assigned Pending Inspection rows in waitingApproval — including staff-moved ones", async () => {
    // Staff may move an assigned WO to Pending Inspection without the
    // mechanic completing it (legal per STAFF_TRANSITIONS), so the count must
    // not filter on repair_completed_by = me — a staff-moved row has a null
    // or other completer and still awaits inspection of this mechanic's work.
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    stubSummary();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const countsSql = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /COUNT\(\*\)\s+AS\s+assigned/.test(sql));
    expect(countsSql).toBeDefined();
    expect(countsSql).toContain("vm.status = 'Pending Inspection'");
    expect(countsSql).not.toContain("repair_completed_by");
  });

  it("refuses an unauthenticated caller without querying", async () => {
    requirePermission.mockRejectedValue(new AuthError("Unauthorized", 401));
    stubSummary();
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(query).not.toHaveBeenCalled();
  });
});
