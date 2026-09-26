import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/notifications/recipients", () => ({
  notificationRolesFor: vi.fn(() => ["admin", "fleet_manager"]),
}));
vi.mock("@/lib/app-errors", () => ({ writeAppError: vi.fn() }));

import { query, withTransaction } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { writeAppError } from "@/lib/app-errors";
import {
  ensureInspectionMaintenance,
  notifyMaintenanceTeam,
  raiseEndDutyWorkOrder,
} from "./maintenance";

const inspectionRow = (over = {}) => ({
  inspection_id: 42,
  vehicle_id: 7,
  inspection_type: "Post-Shift",
  findings: "sira ang preno",
  plate_number: "ABC 1234",
  ...over,
});

const workOrderRow = (over = {}) => ({
  maintenance_id: 99,
  vehicle_id: 7,
  maintenance_type: "Repair",
  maintenance_date: "2026-09-23",
  status: "In Progress",
  priority: "High",
  cost: 0,
  source_inspection_id: 42,
  ...over,
});

/**
 * A transaction whose query() refuses SQL it was not told about.
 *
 * The refuse-by-default matters: a fake that returned `{ rows: [] }` for
 * anything unmatched would make every test here pass without ever exercising
 * the statement under test — the failure mode this repo keeps having to design
 * against. An unexpected query should be loud.
 */
function makeTx(handlers) {
  return {
    query: vi.fn(async (sql, params) => {
      for (const [match, reply] of handlers) {
        if (sql.includes(match)) return typeof reply === "function" ? reply(sql, params) : reply;
      }
      throw new Error(`unexpected SQL: ${String(sql).replace(/\s+/g, " ").slice(0, 80)}`);
    }),
  };
}

// The source read IS matched by "FOR UPDATE OF i", so there is deliberately no
// separate fixture for it: a second handler on the same needle would win by
// being listed first and silently return an empty result, which reads as
// notFound in every test that used it. The same shadowing applies to any needle
// listed twice — hence insertRow() rather than a second INSERT entry.
const openSelect = ["WHERE source_inspection_id = $1", { rows: [] }];
const insertRow = (over = {}) => ["INSERT INTO vehiclemaintenance", { rows: [workOrderRow(over)] }];
const insert = ["INSERT INTO vehiclemaintenance", { rows: [] }];

const call = (handlers = []) => {
  const tx = makeTx(handlers);
  withTransaction.mockImplementation(async (fn) => fn(tx));
  return tx;
};

const paramsOf = (tx, needle) => {
  const c = tx.query.mock.calls.find(([sql]) => String(sql).includes(needle));
  return c?.[1];
};

const insertParams = (tx) => {
  const [sql, values] = tx.query.mock.calls.find(([s]) => String(s).includes("INSERT INTO vehiclemaintenance"));
  const cols = sql.match(/INSERT INTO vehiclemaintenance\s*\(([^)]*)\)/)[1].split(",").map((c) => c.trim());
  return Object.fromEntries(cols.map((c, i) => [c, values[i]]));
};

beforeEach(() => vi.clearAllMocks());

describe("ensureInspectionMaintenance", () => {
  it("does not raise a work order for a Pre-Trip or Pre-Shift failure", async () => {
    // Those failures are recorded but escalate to nobody — a different
    // workflow, deliberately not wired here.
    const tx = call([["FOR UPDATE OF i", { rows: [inspectionRow({ inspection_type: "Pre-Trip" })] }]]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(result).toMatchObject({ notRequired: true });
    expect(tx.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO vehiclemaintenance"), expect.anything());
  });

  it("raises nothing when the driver answered 'nothing unusual'", async () => {
    // The clean answer is a real answer, and the whole point of the two-way
    // flag: it must not file a work order, not even a benign one.
    const tx = call([["FOR UPDATE OF i", { rows: [inspectionRow({ findings: null })] }]]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(result).toMatchObject({ notReported: true });
    expect(tx.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO vehiclemaintenance"), expect.anything());
  });

  it("treats whitespace-only findings as nothing reported", async () => {
    call([["FOR UPDATE OF i", { rows: [inspectionRow({ findings: "   " })] }]]);
    expect(await ensureInspectionMaintenance({ inspectionId: 42 })).toMatchObject({ notReported: true });
  });

  it("grounds the vehicle when the findings match a severe keyword", async () => {
    const tx = call([
      ["FOR UPDATE OF i", { rows: [inspectionRow({ findings: "sira ang preno" })] }],
      openSelect,
      insertRow(),
    ]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(result.created).toBe(true);
    const params = insertParams(tx);
    // "In Progress" is the value /api/vehicles/available excludes on — this is
    // the assertion that ties a keyword match to a vehicle leaving dispatch.
    expect(params.status).toBe("In Progress");
    expect(params.priority).toBe("High");
    expect(params.source_inspection_id).toBe(42);
  });

  it("files a scheduled order, leaving the vehicle dispatchable, for a mild report", async () => {
    const tx = call([
      ["FOR UPDATE OF i", { rows: [inspectionRow({ findings: "maingay ang aircon" })] }],
      openSelect,
      insertRow({ status: "Scheduled", priority: "Normal" }),
    ]);
    await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(insertParams(tx).status).toBe("Scheduled");
    expect(insertParams(tx).priority).toBe("Normal");
  });

  it("carries the driver's words and the provenance into the work order", async () => {
    const tx = call([
      ["FOR UPDATE OF i", { rows: [inspectionRow({ findings: " may usok sa makina " })] }],
      openSelect,
      insertRow(),
    ]);
    await ensureInspectionMaintenance({ inspectionId: 42 });
    const params = insertParams(tx);
    expect(params.description).toContain("may usok sa makina");
    expect(params.description).toContain("inspection #42");
    expect(params.description).toContain("ABC 1234");
  });

  it("returns the existing work order instead of filing a second one", async () => {
    // The retry case. source_inspection_id is unique (migration 121), so the
    // second attempt must find the first row rather than insert.
    const tx = call([
      ["FOR UPDATE OF i", { rows: [inspectionRow()] }],
      ["WHERE source_inspection_id = $1", { rows: [workOrderRow()] }],
    ]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(result).toMatchObject({ created: false });
    expect(tx.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO vehiclemaintenance"), expect.anything());
  });

  it("recovers the work order when a racing insert wins and ON CONFLICT swallows ours", async () => {
    const tx = call([
      ["FOR UPDATE OF i", { rows: [inspectionRow()] }],
      ["WHERE source_inspection_id = $1", (() => {
        let n = 0;
        return () => ({ rows: n++ === 0 ? [] : [workOrderRow()] });
      })()],
      insert,
    ]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42 });
    expect(result).toMatchObject({ created: false });
    expect(result.workOrder.maintenance_id).toBe(99);
  });

  it("throws when neither the insert nor the recovery read produced a row", async () => {
    call([["FOR UPDATE OF i", { rows: [inspectionRow()] }], openSelect, insert]);
    await expect(ensureInspectionMaintenance({ inspectionId: 42 }))
      .rejects.toThrow("End Duty work order could not be created");
  });

  it("reports a missing inspection rather than inventing a work order", async () => {
    call([["FOR UPDATE OF i", { rows: [] }]]);
    expect(await ensureInspectionMaintenance({ inspectionId: 999 })).toMatchObject({ notFound: true });
  });

  it("raises a work order for a failed Pre-Shift only when the office asks", async () => {
    const tx = call([
      ["FOR UPDATE OF i", {
        rows: [inspectionRow({
          inspection_type: "Pre-Shift",
          severity: "High",
          checklist: [{ item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "malambot" }],
        })],
      }],
      ["WHERE source_inspection_id = $1", { rows: [] }],
      ["INSERT INTO vehiclemaintenance", { rows: [workOrderRow()] }],
    ]);
    const result = await ensureInspectionMaintenance({ inspectionId: 42, allowChecklistType: true });
    expect(result).toMatchObject({ created: true });
    // Scheduled, not In Progress: a raise from the queue must never ground.
    expect(paramsOf(tx, "INSERT INTO vehiclemaintenance")).toContain("Scheduled");
  });

  it("still refuses a failed Pre-Shift when the flag is not passed", async () => {
    // The automatic path. This is the same assertion the pre-existing test makes,
    // restated for the option's default so a future refactor cannot widen it.
    call([["FOR UPDATE OF i", { rows: [inspectionRow({ inspection_type: "Pre-Shift" })] }]]);
    await expect(ensureInspectionMaintenance({ inspectionId: 42 })).resolves.toMatchObject({ notRequired: true });
  });
});

describe("notifyMaintenanceTeam", () => {
  it("pages the maintenance-queue audience and casts the dedupe parameters", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ employee_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ employee_id: 5 }] });
    await notifyMaintenanceTeam(workOrderRow(), 42);

    const notifySql = String(query.mock.calls[1][0]);
    // Regression lock on the 42P08 trap the incident notifier documents: without
    // these casts the statement fails to parse and the notifier goes silent.
    expect(notifySql).toContain("$2::varchar");
    expect(notifySql).toContain("$5::varchar");
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: [5] }));
  });

  it("says the vehicle is out of dispatch only when it actually is", async () => {
    query.mockResolvedValueOnce({ rows: [{ employee_id: 5 }] }).mockResolvedValueOnce({ rows: [{ employee_id: 5 }] });
    await notifyMaintenanceTeam(workOrderRow(), 42);
    expect(String(query.mock.calls[1][1][2])).toMatch(/out of dispatch/);

    vi.clearAllMocks();
    query.mockResolvedValueOnce({ rows: [{ employee_id: 5 }] }).mockResolvedValueOnce({ rows: [{ employee_id: 5 }] });
    await notifyMaintenanceTeam(workOrderRow({ status: "Scheduled" }), 42);
    expect(String(query.mock.calls[1][1][2])).toMatch(/remains dispatchable/);
  });

  it("does nothing when no one holds the queue", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await notifyMaintenanceTeam(workOrderRow(), 42);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("does not describe an office raise as an end-of-shift report", async () => {
    // The plan printed this without seeding the recipients read; query is a bare
    // vi.fn(), so destructuring `{ rows }` from its undefined return threw before
    // the assertion could run. Seeded the same way the two tests above do.
    query
      .mockResolvedValueOnce({ rows: [{ employee_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ employee_id: 5 }] });
    await notifyMaintenanceTeam({ maintenance_id: 99, vehicle_id: 7, status: "Scheduled" }, 42, {
      source: "failed Pre-Shift inspection",
    });
    const [, params] = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(params[2]).toContain("failed Pre-Shift inspection");
    expect(params[2]).not.toContain("end-of-shift");
  });
});

describe("raiseEndDutyWorkOrder", () => {
  it("never throws when the work order fails, and records why", async () => {
    // Called from the path that ends a shift: a maintenance failure must not
    // strand the driver in the app at the end of the day.
    withTransaction.mockRejectedValue(new Error("deadlock detected"));
    const result = await raiseEndDutyWorkOrder({ inspectionId: 42, route: "/api/mobile/driver/duty" });
    expect(result).toEqual({ failed: true });
    expect(writeAppError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("work order failed"),
    }));
  });

  it("distinguishes a lost notification from a lost work order", async () => {
    // The work order exists in this case, so reporting "the work order failed"
    // would be false — the vehicle is grounded and only the announcement was lost.
    call([["FOR UPDATE OF i", { rows: [inspectionRow()] }], openSelect, insertRow()]);
    query.mockRejectedValue(new Error("notifications table unreachable"));
    const result = await raiseEndDutyWorkOrder({ inspectionId: 42, route: "/api/mobile/driver/duty" });
    expect(result.created).toBe(true);
    expect(writeAppError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("notification failed"),
    }));
  });

  it("does not log an error for the ordinary 'nothing reported' outcome", async () => {
    call([["FOR UPDATE OF i", { rows: [inspectionRow({ findings: null })] }]]);
    const result = await raiseEndDutyWorkOrder({ inspectionId: 42 });
    expect(result).toMatchObject({ notReported: true });
    expect(writeAppError).not.toHaveBeenCalled();
  });
});
