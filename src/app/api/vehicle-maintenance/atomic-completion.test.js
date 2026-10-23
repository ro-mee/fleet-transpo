import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ tx: null, state: null, committed: null, fail: null, events: [] }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => { throw new Error("Unexpected global query"); }),
  withTransaction: vi.fn(async (run) => {
    h.events.push("begin");
    const saved = structuredClone(h.state);
    try { const result = await run(h.tx); h.committed = structuredClone(h.state); h.events.push("commit"); return result; }
    catch (e) { h.state = saved; h.events.push("rollback"); throw e; }
  }),
}));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { role: "fleet_manager", employeeId: 888 } })),
  parseBody: async (req) => req.body,
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (error, status = 400) => Response.json({ error }, { status }),
  errValidation: (errors) => Response.json({ errors }, { status: 400 }),
  handleError: () => Response.json({ error: "failed" }, { status: 500 }),
}));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: vi.fn(async (tx) => { expect(tx).toBe(h.tx); h.events.push("audit"); }) }));
vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn(async (_id, tx) => { expect(tx).toBe(h.tx); h.events.push("status"); if (h.fail === "status") throw new Error("status failed"); }) }));
vi.mock("@/services/maintenance-schedule.service", () => ({ recomputeVehicleSchedule: vi.fn(async (_id, row, tx) => { expect(tx).toBe(h.tx); h.events.push("schedule"); if (h.fail === "schedule") throw new Error("schedule failed"); }) }));
vi.mock("@/lib/maintenance/notifications", () => ({ fanoutMaintenanceNotification: vi.fn() }));
import { PUT } from "./[id]/route";
import { POST } from "./route";
import { syncVehicleStatus } from "@/services/status.service";
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
beforeEach(() => {
  vi.clearAllMocks(); h.events = []; h.fail = null; h.committed = null;
  h.state = { maintenance_id: 123, vehicle_id: 7, status: "Scheduled", maintenance_type: "Routine", maintenance_date: "2030-01-01", repair_completed_by: null, completed_date: null };
  h.tx = { query: vi.fn(async (sql, values) => {
    if (sql.includes("SELECT status")) return { rows: [{ ...h.state }] };
    if (sql.includes("FROM vehicles") && sql.includes("FOR UPDATE")) { h.events.push("lock"); return { rows: [] }; }
    if (sql.includes("UPDATE vehiclemaintenance")) {
      for (const m of sql.matchAll(/(\w+) = \$(\d+)/g)) h.state[m[1]] = values[Number(m[2]) - 1];
      if (sql.includes("completed_date = (NOW() AT TIME ZONE 'Asia/Manila')::date")) h.state.completed_date = "2026-10-24";
      h.events.push("write"); return { rows: [{ ...h.state }] };
    }
    if (sql.includes("INSERT INTO vehiclemaintenance")) { h.state.status = "Scheduled"; h.events.push("write"); return { rows: [{ ...h.state }] }; }
    return { rows: [] };
  }) };
});
const put = (body) => PUT({ body }, { params: Promise.resolve({ id: "123" }) });
describe("maintenance atomic writes", () => {
  it("locks the vehicle before completion and commits status, routine schedule and audit together", async () => {
    expect((await put({ status: "Completed" })).status).toBe(200);
    expect(h.events.indexOf("lock")).toBeLessThan(h.events.indexOf("write"));
    expect(h.events.indexOf("status")).toBeLessThan(h.events.indexOf("commit"));
    expect(h.events.indexOf("schedule")).toBeLessThan(h.events.indexOf("commit"));
    expect(h.committed.status).toBe("Completed");
    expect(h.committed.completed_date).toBe("2026-10-24");
  });
  it("locks the resulting Routine plan before its order when approval also changes vehicle and type", async () => {
    h.state.maintenance_type="Corrective";
    expect((await put({status:"Completed",vehicle_id:3,maintenance_type:"Routine"})).status).toBe(200);
    const calls=h.tx.query.mock.calls;
    const plan=calls.findIndex(([sql])=>sql.includes("FROM vehicle_service_plans") && sql.includes("FOR UPDATE"));
    const order=calls.findIndex(([sql])=>sql.includes("FROM vehiclemaintenance") && sql.includes("FOR UPDATE"));
    expect(plan).toBeGreaterThan(-1); expect(plan).toBeLessThan(order); expect(calls[plan][1]).toEqual([3]);
  });
  it.each(["schedule", "status"])("rolls completion back when %s fails", async (failure) => {
    h.fail = failure;
    expect((await put({ status: "Completed" })).status).toBe(500);
    expect(h.state.status).toBe("Scheduled"); expect(h.committed).toBeNull();
    expect(h.events).toContain("rollback");
  });
  it("uses a supplied actual date instead of its future scheduled date", async () => {
    expect((await put({ status: "Completed", completed_date: "2026-10-01" })).status).toBe(200);
    expect(h.committed.completed_date).toBe("2026-10-01");
  });
  it("locks both old and new vehicle ids in stable order and synchronizes both on reassignment", async () => {
    expect((await put({ vehicle_id: 3 })).status).toBe(200);
    const lock = h.tx.query.mock.calls.find(([sql]) => sql.includes("FROM vehicles") && sql.includes("FOR UPDATE"));
    expect(lock[0]).toContain("ORDER BY vehicle_id"); expect(lock[1]).toEqual([[3, 7]]);
    expect(syncVehicleStatus.mock.calls.map(([id]) => id)).toEqual([3, 7]);
  });
  it("archives a completed record without advancing the routine schedule", async () => {
    h.state.status = "Completed";
    expect((await put({ deleted_at: "2026-10-24T00:00:00Z" })).status).toBe(200);
    expect(recomputeVehicleSchedule).not.toHaveBeenCalled();
  });
  it("keeps POST scheduled and synchronizes status before creation commits", async () => {
    const res = await POST({ body: { vehicle_id: 7, maintenance_type: "Routine", maintenance_date: "2026-10-24", status: "Completed", completed_date: "2026-10-01" } });
    expect(res.status).toBe(201); expect(h.committed.status).toBe("Scheduled");
    expect(h.events.indexOf("status")).toBeLessThan(h.events.indexOf("commit"));
    expect(recomputeVehicleSchedule).not.toHaveBeenCalled();
  });
  it("rolls POST creation back if status synchronization fails", async () => {
    h.fail = "status";
    const res = await POST({ body: { vehicle_id: 7, maintenance_type: "Routine", maintenance_date: "2026-10-24" } });
    expect(res.status).toBe(500); expect(h.committed).toBeNull(); expect(h.events).toContain("rollback");
  });
});
