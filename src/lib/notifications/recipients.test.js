import { describe, it, expect } from "vitest";
import {
  SILENT_ROLES,
  notificationRolesFor,
  dedupeEmployeeIds,
} from "./recipients";

describe("notification routing: notificationRolesFor", () => {
  it("derives from authority but strips the system_admin bypass", () => {
    const roles = notificationRolesFor("incidents", "read");
    expect(roles).toContain("admin");
    expect(roles).toContain("fleet_manager");
    expect(roles).toContain("dispatcher");
    expect(roles).not.toContain("system_admin");
  });

  it("route_to_maintenance resolves to the maintenance queue owners only", () => {
    expect(notificationRolesFor("incidents", "route_to_maintenance").sort()).toEqual(
      ["admin", "fleet_manager"]
    );
  });

  it("supports extra exclusions for action-required alerts (management observes, never acts)", () => {
    const roles = notificationRolesFor("incidents", "read", {
      exclude: [...SILENT_ROLES, "management"],
    });
    expect(roles).not.toContain("system_admin");
    expect(roles).not.toContain("management");
    expect(roles).toContain("dispatcher");
  });

  it("returns a safe empty set for unknown authority", () => {
    expect(notificationRolesFor("nope", "nope")).toEqual([]);
  });
});

describe("notification routing: dedupeEmployeeIds", () => {
  it("collapses the same employee qualifying through two paths into one", () => {
    expect(dedupeEmployeeIds([7, 3, 7, 3, 9])).toEqual([7, 3, 9]);
  });

  it("drops non-integers, zeros, negatives, and nullish values", () => {
    expect(dedupeEmployeeIds([1, 0, -2, "x", null, undefined, 2.5, "4", 4])).toEqual([1, 4]);
  });

  it("handles missing input", () => {
    expect(dedupeEmployeeIds()).toEqual([]);
    expect(dedupeEmployeeIds(null)).toEqual([]);
  });
});
