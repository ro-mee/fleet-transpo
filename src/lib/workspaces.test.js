import { describe, expect, it } from "vitest";
import { ClipboardCheck, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/workspaces";
import { getRequiredRolesForPath, rolesFor } from "@/lib/auth/permissions";

function assignmentIcon(role) {
  return getWorkspace(role).nav
    .flatMap((group) => group.items || [])
    .find((item) => item.href === "/fleet/assignments")?.icon;
}

describe("role-specific Driver Assignments sidebar icons", () => {
  it("uses a distinct clipboard icon for Fleet Manager while preserving Admin's UsersRound import", () => {
    expect(assignmentIcon("fleet_manager")).toBe(ClipboardCheck);
    expect(assignmentIcon("admin")).toBe(UsersRound);
    expect(assignmentIcon("fleet_manager")).not.toBe(assignmentIcon("admin"));
  });
});

describe("expense navigation and permissions", () => {
  const hrefs = (items) => items.flatMap((item) => [item.href, ...hrefs(item.items || []), ...hrefs(item.children || [])]).filter(Boolean);
  it.each(["super_admin", "admin", "fleet_manager", "management"])("makes expenses discoverable to %s", (role) => {
    expect(hrefs(getWorkspace(role).nav)).toContain("/expenses");
    expect(getRequiredRolesForPath("/expenses")).toContain(role);
    expect(rolesFor("expenses", "read")).toContain(role);
  });
  it.each(["dispatcher", "driver", "mechanic"])("keeps financial review outside the %s workspace", (role) => {
    expect(hrefs(getWorkspace(role).nav)).not.toContain("/expenses");
    expect(getRequiredRolesForPath("/expenses")).not.toContain(role);
    expect(rolesFor("expenses", "review")).not.toContain(role);
  });
  it("keeps management review authority disabled", () => {
    expect(rolesFor("expenses", "review")).not.toContain("management");
  });
});
