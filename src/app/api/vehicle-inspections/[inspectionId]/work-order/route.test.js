import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/inspections/maintenance", () => ({
  ensureInspectionMaintenance: vi.fn(),
  notifyMaintenanceTeam: vi.fn(),
}));

import { requirePermission } from "@/lib/api/utils";
import { ensureInspectionMaintenance, notifyMaintenanceTeam } from "@/lib/inspections/maintenance";
import { POST } from "./route";

const ctx = (inspectionId = "42") => ({ params: Promise.resolve({ inspectionId }) });
const req = () => new Request("http://test/x", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
  notifyMaintenanceTeam.mockResolvedValue(undefined);
});

describe("POST work-order", () => {
  it("requires the maintenance create capability", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notFound: true });
    await POST(req(), ctx());
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "maintenance", "create");
  });

  it("raises the work order and announces it, returning 201", async () => {
    const workOrder = { maintenance_id: 99, status: "Scheduled" };
    ensureInspectionMaintenance.mockResolvedValue({
      workOrder, created: true, inspection: { inspection_id: 42, inspection_type: "Pre-Shift" },
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(201);
    // The flag is what lets a checklist type through. Passing it is this route's
    // entire reason to exist; omitting it would turn the button into a 400.
    expect(ensureInspectionMaintenance).toHaveBeenCalledWith({
      inspectionId: 42,
      session: expect.objectContaining({ user: expect.anything() }),
      allowChecklistType: true,
    });
    // The source is derived from the record, so the announcement cannot call a
    // Pre-Shift an end-of-shift report.
    expect(notifyMaintenanceTeam).toHaveBeenCalledWith(workOrder, 42, { source: "failed Pre-Shift inspection" });
  });

  it("calls it an end-of-shift report when it actually was one", async () => {
    const workOrder = { maintenance_id: 99, status: "Scheduled" };
    ensureInspectionMaintenance.mockResolvedValue({
      workOrder, created: true, inspection: { inspection_id: 42, inspection_type: "Post-Shift" },
    });
    await POST(req(), ctx());
    expect(notifyMaintenanceTeam).toHaveBeenCalledWith(workOrder, 42, { source: "end-of-shift report" });
  });

  it("is idempotent — an existing work order is 200 and is not re-announced", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ workOrder: { maintenance_id: 99 }, created: false });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(notifyMaintenanceTeam).not.toHaveBeenCalled();
  });

  it("treats an unexpected refusal as a server error, not a user error", async () => {
    // Unreachable while this route passes allowChecklistType — the module only
    // refuses a checklist type when the flag is false. Kept because a future
    // refusal reason must not read as success, and a 500 is easier to find in
    // the logs than a created:false nobody looks at.
    ensureInspectionMaintenance.mockResolvedValue({ notRequired: true, inspection: { inspection_type: "Pre-Shift" } });
    expect((await POST(req(), ctx())).status).toBe(500);
  });

  it("refuses an End Duty report that recorded nothing unusual", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notReported: true });
    expect((await POST(req(), ctx())).status).toBe(400);
  });

  it("is a 404 for an inspection that does not exist", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ notFound: true });
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("rejects a non-numeric inspection id before touching the database", async () => {
    const res = await POST(req(), ctx("abc"));
    expect(res.status).toBe(400);
    expect(ensureInspectionMaintenance).not.toHaveBeenCalled();
  });

  it("reports a notification failure as a 500 that names which half failed", async () => {
    ensureInspectionMaintenance.mockResolvedValue({ workOrder: { maintenance_id: 99 }, created: true });
    notifyMaintenanceTeam.mockRejectedValue(new Error("push down"));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
    // The row exists, so a bare "could not create" would be a lie.
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("99") });
  });
});
