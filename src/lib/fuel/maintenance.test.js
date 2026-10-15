import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn(async () => null) }));

import { query } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { notifyFuelDiagnosticTeam } from "./maintenance";
import { getNotificationHref } from "@/lib/notifications/target";

const WO = { maintenance_id: 44, vehicle_id: 12 };

function stubRecipients(employeeIds) {
  query.mockImplementation(async (sql) => {
    if (String(sql).includes("FROM employees")) {
      return { rows: employeeIds.map((employee_id) => ({ employee_id })) };
    }
    // INSERT … WHERE NOT EXISTS: one fresh row per recipient.
    return { rows: [{ employee_id: 1 }] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyFuelDiagnosticTeam", () => {
  it("does nothing without a work order id", async () => {
    expect(await notifyFuelDiagnosticTeam(null)).toEqual({ notified: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it("pages the maintenance queue owners with the fuel-specific title and dedupe guard", async () => {
    stubRecipients([9, 10]);
    const { notified } = await notifyFuelDiagnosticTeam(WO, { plate: "ABC 1234" });
    expect(notified).toEqual([9, 10]);

    // The audience is the incident route_to_maintenance set (admin +
    // fleet_manager), resolved through roles — never hardcoded ids.
    const audienceCall = query.mock.calls.find(([sql]) => String(sql).includes("FROM employees"));
    expect(audienceCall[1][0].sort()).toEqual(["admin", "fleet_manager"]);

    const inserts = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(2);
    for (const [sql, params] of inserts) {
      expect(sql).toContain("WHERE NOT EXISTS");
      expect(sql).toContain("$2::varchar");
      expect(params[1]).toBe("Fuel Efficiency Diagnostic Filed");
      expect(params[3]).toBe("Alert");
      expect(params[4]).toBe("fuel_diagnostic");
      expect(params[5]).toBe(44);
      expect(getNotificationHref({ reference_type: params[4], reference_id: params[5], link: params[6] }, "fleet_manager")).toBe("/maintenance");
      expect(params[2]).toContain("ABC 1234");
      // The honesty line travels with the page, not just the work order.
      expect(params[2]).toMatch(/period aggregate/i);
    }
    expect(sendPush).toHaveBeenCalledOnce();
    expect(sendPush.mock.calls[0][0]).toMatchObject({
      employeeIds: [9, 10],
      title: "Fuel Efficiency Diagnostic Filed",
    });
    expect(getNotificationHref(sendPush.mock.calls[0][0].data, "fleet_manager")).toBe("/maintenance");
  });

  it("skips the push when every recipient already has the row (retry-safe)", async () => {
    query.mockImplementation(async (sql) => {
      if (String(sql).includes("FROM employees")) return { rows: [{ employee_id: 9 }] };
      return { rows: [] };
    });
    const { notified } = await notifyFuelDiagnosticTeam(WO, { plate: "ABC 1234" });
    expect(notified).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });
});
