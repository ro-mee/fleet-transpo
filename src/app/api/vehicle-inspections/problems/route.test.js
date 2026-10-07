import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/inspections/problem-queue", () => ({
  // The route reads PROBLEM_QUEUE_LIMIT at module scope for its own cap, so the
  // factory has to supply it: the plan's mock omitted it and the suite could
  // not even load, failing at route.js:15 before a single assertion ran.
  PROBLEM_QUEUE_LIMIT: 100,
  listVehicleProblems: vi.fn(),
  countProblemCounts: vi.fn(),
}));

import { requirePermission } from "@/lib/api/utils";
import { listVehicleProblems, countProblemCounts } from "@/lib/inspections/problem-queue";
import { GET } from "./route";

const req = (url = "http://test/api/vehicle-inspections/problems") => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
});

describe("GET /api/vehicle-inspections/problems", () => {
  it("requires the maintenance read capability", async () => {
    listVehicleProblems.mockResolvedValue({ items: [], counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 0 } });
    await GET(req());
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "maintenance", "read");
  });

  it("returns the queue page", async () => {
    listVehicleProblems.mockResolvedValue({ items: [{ inspectionId: 42 }], counts: { reportedUntracked: 1, failedUntracked: 0, tracked: 0 } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [{ inspectionId: 42 }], counts: { reportedUntracked: 1, failedUntracked: 0, tracked: 0 } });
  });

  it("answers scope=count with the exact count and no rows", async () => {
    countProblemCounts.mockResolvedValue({ reportedUntracked: 4, failedUntracked: 9, tracked: 11 });
    const res = await GET(req("http://test/api/vehicle-inspections/problems?scope=count"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ counts: { reportedUntracked: 4, failedUntracked: 9, tracked: 11 } });
    // The strip must not pull the page: that is the whole reason this branch exists.
    expect(listVehicleProblems).not.toHaveBeenCalled();
  });

  it("bounds the page window and refuses a nonsense one", async () => {
    listVehicleProblems.mockResolvedValue({ items: [], counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 0 } });
    await GET(req("http://test/api/vehicle-inspections/problems?limit=100000&offset=-5"));
    expect(listVehicleProblems).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  it("refuses an unauthenticated caller without querying", async () => {
    requirePermission.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(listVehicleProblems).not.toHaveBeenCalled();
  });

  // Task 4 — a mechanic sees only problems linked (via source_inspection_id)
  // to their own assigned, non-archived work orders. Staff calls stay
  // byte-identical (no assignee key), so the suite above keeps passing.
  it("scopes the queue to the mechanic's own work orders", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    listVehicleProblems.mockResolvedValue({ items: [], counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 0 } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(listVehicleProblems).toHaveBeenCalledWith({ limit: 100, offset: 0, assignedMechanicId: 77 });
  });

  it("scopes scope=count the same way, without pulling rows", async () => {
    requirePermission.mockResolvedValue({ user: { role: "mechanic", employeeId: 77 } });
    countProblemCounts.mockResolvedValue({ reportedUntracked: 1, failedUntracked: 0, tracked: 2 });
    const res = await GET(req("http://test/api/vehicle-inspections/problems?scope=count"));
    expect(res.status).toBe(200);
    expect(countProblemCounts).toHaveBeenCalledWith({ assignedMechanicId: 77 });
    expect(listVehicleProblems).not.toHaveBeenCalled();
  });
});
