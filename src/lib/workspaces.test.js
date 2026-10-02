import { describe, expect, it } from "vitest";
import { ClipboardCheck, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/workspaces";

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
