import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn(async () => null) }));
vi.mock("@/services/maintenance-schedule.service", () => ({ recomputeVehicleSchedule: vi.fn(async () => null) }));
vi.mock("@/lib/fuel/maintenance", () => ({ notifyFuelDiagnosticTeam: vi.fn(async () => ({ notified: [] })) }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn(async () => null) }));

import { requirePermission } from "@/lib/api/utils";
import { query, withTransaction } from "@/lib/db";
import { notifyFuelDiagnosticTeam } from "@/lib/fuel/maintenance";
import { POST } from "./route";
import { buildFuelDiagnosticPayload, nextCalendarDay } from "@/lib/fuel/diagnostic";
import { sendPush } from "@/services/push.service";
import { getNotificationHref } from "@/lib/notifications/target";

function mockSession(role = "fleet_manager", employeeId = 888) {
  requirePermission.mockResolvedValue({ user: { role, employeeId } });
}

function stubDb(inserted) {
  query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes("INSERT INTO vehiclemaintenance")) return { rows: [inserted] };
    if (text.includes("FROM vehicles")) return { rows: [{ plate_number: "ABC 1234" }] };
    return { rows: [{}] };
  });
  // The audit write runs inside the transaction; everything else delegates to
  // the query stub above so the INSERT path is observable in one place.
  withTransaction.mockImplementation(async (cb) => cb({ query: (sql, values) => query(sql, values) }));
}

function insertParams() {
  const call = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO vehiclemaintenance"));
  const columns = call[0].match(/INSERT INTO vehiclemaintenance \((.*?)\)/)[1].split(",").map((c) => c.trim());
  const params = {};
  columns.forEach((col, i) => { params[col] = call[1][i]; });
  return params;
}

function diagnosticBody(over = {}) {
  return {
    ...buildFuelDiagnosticPayload({
      vehicleId: 12,
      plate: "ABC 1234",
      estimatedKmpl: 6.42,
      baselineKmpl: 8.5,
      variancePercent: -24.5,
      from: "2026-09-01",
      to: "2026-09-30",
      trips: 18,
      km: 1240.5,
      liters: 193.2,
    }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/vehicle-maintenance — fuel diagnostic filing", () => {
  it.each(["Normal", "High", "Emergency"])("notifies a mechanic assigned during %s priority creation", async (priority) => {
    mockSession();
    stubDb({ maintenance_id: 44, vehicle_id: 12, status: "Scheduled", priority, assigned_mechanic_id: 77 });
    const old = query.getMockImplementation();
    query.mockImplementation(async (sql, values) => {
      if (sql.includes("JOIN roles")) return { rows: [{ employee_id: 9 }, { employee_id: 77 }] };
      if (sql.includes("FROM employees")) return { rows: [{ employee_id: 77 }] };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ employee_id: values[0] }] };
      return old(sql, values);
    });
    expect((await POST({ json: async () => diagnosticBody({ assigned_mechanic_id: 77, priority }) })).status).toBe(201);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: [77], data: { reference_type: "mechanic_maintenance", reference_id: 44 } }));
    expect(sendPush).toHaveBeenCalledTimes(priority === "Normal" ? 1 : 2);
    if (priority !== "Normal") {
      expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: [9], data: { reference_type: "maintenance", reference_id: 44 } }));
      const [, stored] = query.mock.calls.find(([sql, values]) => sql.includes("INSERT INTO notifications") && values[0] === 9);
      expect(getNotificationHref({ reference_type: stored[4], reference_id: stored[5] }, "fleet_manager")).toBe("/maintenance");
      const staffPush = sendPush.mock.calls.find(([push]) => push.employeeIds.includes(9))[0];
      expect(getNotificationHref(staffPush.data, "fleet_manager")).toBe("/maintenance");
    }
  });
  it("returns persisted work order when assignment notification fails and logs the failure", async () => {
    mockSession();
    stubDb({ maintenance_id: 44, vehicle_id: 12, status: "Scheduled", priority: "Normal", assigned_mechanic_id: 77 });
    const old = query.getMockImplementation();
    query.mockImplementation(async (sql, values) => {
      if (sql.includes("FROM employees")) return { rows: [{ employee_id: 77 }] };
      if (sql.includes("INSERT INTO notifications")) throw new Error("notification unavailable");
      return old(sql, values);
    });
    const response = await POST({ json: async () => diagnosticBody({ assigned_mechanic_id: 77 }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ maintenance_id: 44 });
    expect(query.mock.calls.some(([sql, values]) => sql.includes("INSERT INTO app_errors") && values.some((value) => typeof value === "string" && value.includes("notification unavailable")))).toBe(true);
  });
  it("creates the diagnostic as Scheduled/Normal/cost-0 dated tomorrow, stamped + notified", async () => {
    mockSession();
    // Spoof attempt rides along: status, completion identity, and provenance
    // must all be server-decided, never client-decided. ("Completed" is not
    // spoofed here: validation rejects Completed+future before the force, so
    // "In Progress" is the status-spoof that reaches it.)
    stubDb({ maintenance_id: 44, vehicle_id: 12, status: "Scheduled" });
    const res = await POST({ json: async () => diagnosticBody({ status: "In Progress", completed_by: 999, created_by: 999 }) });
    expect(res.status).toBe(201);

    const params = insertParams();
    expect(params.status).toBe("Scheduled");
    expect(params.maintenance_type).toBe("Inspection");
    expect(params.priority).toBe("Normal");
    expect(params.cost).toBe(0);
    expect(params.maintenance_date).toBe(nextCalendarDay());
    expect(params.created_by).toBe(888);
    expect(params.completed_by).toBeUndefined();
    expect(params.completed_at).toBeUndefined();

    expect(notifyFuelDiagnosticTeam).toHaveBeenCalledOnce();
    expect(notifyFuelDiagnosticTeam.mock.calls[0][0]).toMatchObject({ maintenance_id: 44 });
    expect(notifyFuelDiagnosticTeam.mock.calls[0][1]).toMatchObject({ plate: "ABC 1234" });
  });

  it("stamps created_by from the session on ordinary creates without notifying the fuel queue", async () => {
    mockSession("admin", 777);
    stubDb({ maintenance_id: 45, vehicle_id: 3, status: "Scheduled" });
    const res = await POST({
      json: async () => ({ vehicle_id: 3, maintenance_date: nextCalendarDay(), maintenance_type: "Routine", cost: 100 }),
    });
    expect(res.status).toBe(201);
    expect(insertParams().created_by).toBe(777);
    expect(notifyFuelDiagnosticTeam).not.toHaveBeenCalled();
  });
});
