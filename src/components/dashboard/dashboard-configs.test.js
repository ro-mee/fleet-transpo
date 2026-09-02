import { describe, expect, it } from "vitest";
import { DASHBOARD_CONFIGS } from "@/components/dashboard/dashboard-configs";

describe("role dashboard definitions", () => {
  it("keeps each staff role focused on a distinct decision surface", () => {
    const layouts = Object.values(DASHBOARD_CONFIGS).map((config) => config.layout.join("|"));
    expect(new Set(layouts).size).toBe(layouts.length);
    expect(DASHBOARD_CONFIGS.system_admin.layout).toContain("audit");
    expect(DASHBOARD_CONFIGS.dispatcher.layout).toContain("priority-queue");
    expect(DASHBOARD_CONFIGS.fleet_manager.layout).toContain("pair-coverage");
    expect(DASHBOARD_CONFIGS.admin.layout).toContain("operations-pulse");
  });
});
