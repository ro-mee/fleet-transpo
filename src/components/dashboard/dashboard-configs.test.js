import { describe, expect, it } from "vitest";
import { DASHBOARD_CONFIGS } from "@/components/dashboard/dashboard-configs";

describe("role dashboard definitions", () => {
  it("keeps each staff role focused on a distinct decision surface", () => {
    const layouts = Object.values(DASHBOARD_CONFIGS).map((config) => config.layout.join("|"));
    expect(new Set(layouts).size).toBe(layouts.length);
    expect(DASHBOARD_CONFIGS.super_admin.layout).toContain("audit");
    expect(DASHBOARD_CONFIGS.dispatcher.layout).toContain("priority-queue");
    expect(DASHBOARD_CONFIGS.fleet_manager.layout).toContain("pair-coverage");
    expect(DASHBOARD_CONFIGS.admin.layout).toContain("operations-pulse");
  });

  it("ships the vehicle problem count to the two roles that render it", () => {
    expect(DASHBOARD_CONFIGS.admin.queries).toContain("vehicleProblems");
    expect(DASHBOARD_CONFIGS.fleet_manager.queries).toContain("vehicleProblems");
    // The reason the count is rendered in two places rather than one: admin has
    // the operational attention strip, fleet_manager does not. If this ever
    // becomes false, the fleet_manager StatCard is redundant — and if it becomes
    // true without a second look, the strip item alone was enough.
    expect(DASHBOARD_CONFIGS.admin.layout).toContain("attention");
    expect(DASHBOARD_CONFIGS.fleet_manager.layout).not.toContain("attention");
    // Neither role is missing the query its own layout depends on.
    for (const role of ["admin", "fleet_manager"]) {
      expect(DASHBOARD_CONFIGS[role].queries).toContain("maintenance");
    }
  });
});
