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

const WO = (over = {}) => ({
  maintenance_id: 5,
  vehicle_id: 1,
  maintenance_type: "Brake Repair",
  maintenance_date: "2026-10-03",
  status: "In Progress",
  priority: "High",
  diagnosis: "worn pads",
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
        "ageMinutes", "diagnosis", "maintenance_date", "maintenance_id",
        "maintenance_type", "priority", "status", "vehicle", "vehicle_id",
      ]);
      expect(Object.keys(row.vehicle).sort()).toEqual(["plate_number", "vehicle_name"]);
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

  it("refuses an unauthenticated caller without querying", async () => {
    requirePermission.mockRejectedValue(new AuthError("Unauthorized", 401));
    stubSummary();
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(query).not.toHaveBeenCalled();
  });
});
