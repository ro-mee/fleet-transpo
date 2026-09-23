// SA-RBAC — Super Admin / Admin privilege boundary regression suite.
//
// Assignment (POST /api/auth/register) and target mutation (enable/disable,
// credential reset) are separate paths with separate guards; both are pinned
// here so the hierarchy cannot silently widen.
import { describe, it, expect } from "vitest";
import { ROLE_IDS } from "@/lib/constants";
import { normalizeRoleName } from "@/lib/auth/role-names";
import {
  canAssignRole,
  canMutateAccount,
  isPrivilegedTarget,
  roleNameForId,
} from "@/lib/auth/privilege";
import { can, rolesFor, NAV_ROLES } from "@/lib/auth/permissions";

describe("SA-RBAC role identity", () => {
  it("super_admin is the canonical live role at id 1", () => {
    expect(ROLE_IDS.super_admin).toBe(1);
    expect(roleNameForId(1)).toBe("super_admin");
  });

  it("unknown role names fail closed instead of aliasing to a privilege", () => {
    expect(normalizeRoleName("system_admin")).toBe("system_admin");
    expect(can({ roles: { role_name: "system_admin" } }, "reservations", "read")).toBe(false);
    expect(canMutateAccount("system_admin", "admin")).toBe(false);
    expect(canAssignRole("system_admin", ROLE_IDS.admin)).toBe(false);
  });
});

describe("SA-RBAC super_admin bypass", () => {
  it("SA-RBAC-001: super_admin bypasses the normal permission matrix", () => {
    expect(can({ roles: { role_name: "super_admin" } }, "system", "remediate")).toBe(true);
    expect(can({ roles: { role_name: "super_admin" } }, "nope", "nope")).toBe(true);
  });

  it("SA-RBAC-002: admin does NOT bypass the matrix", () => {
    expect(can({ roles: { role_name: "admin" } }, "ai_settings", "update")).toBe(false);
    expect(can({ roles: { role_name: "admin" } }, "system", "read")).toBe(false);
  });
});

describe("SA-RBAC provisioning hierarchy", () => {
  it("SA-RBAC-003: admin cannot create super_admin", () => {
    expect(canAssignRole("admin", ROLE_IDS.super_admin)).toBe(false);
  });

  it("SA-RBAC-004: admin cannot create admin", () => {
    expect(canAssignRole("admin", ROLE_IDS.admin)).toBe(false);
  });

  it("SA-RBAC-005/006: super_admin can create admin and super_admin", () => {
    expect(canAssignRole("super_admin", ROLE_IDS.admin)).toBe(true);
    expect(canAssignRole("super_admin", ROLE_IDS.super_admin)).toBe(true);
  });

  it("both can create lower staff roles; driver goes through the Drivers Directory", () => {
    for (const id of [ROLE_IDS.fleet_manager, ROLE_IDS.dispatcher, ROLE_IDS.management]) {
      expect(canAssignRole("super_admin", id)).toBe(true);
      expect(canAssignRole("admin", id)).toBe(true);
    }
    expect(canAssignRole("super_admin", ROLE_IDS.driver)).toBe(false);
    expect(canAssignRole("admin", ROLE_IDS.driver)).toBe(false);
  });
});

describe("SA-RBAC target protection", () => {
  it("SA-RBAC-007/009: admin cannot disable or reset super_admin", () => {
    expect(canMutateAccount("admin", "super_admin")).toBe(false);
    // The retired name is unknown, and unknown targets fail closed.
    expect(canMutateAccount("admin", "system_admin")).toBe(false);
    expect(canMutateAccount("super_admin", "system_admin")).toBe(false);
  });

  it("SA-RBAC-008/010: admin cannot mutate another admin", () => {
    expect(canMutateAccount("admin", "admin")).toBe(false);
  });

  it("super_admin can manage privileged accounts; admin keeps staff scope", () => {
    expect(canMutateAccount("super_admin", "super_admin")).toBe(true);
    expect(canMutateAccount("super_admin", "admin")).toBe(true);
    for (const role of ["fleet_manager", "dispatcher", "management"]) {
      expect(canMutateAccount("super_admin", role)).toBe(true);
      expect(canMutateAccount("admin", role)).toBe(true);
    }
    expect(isPrivilegedTarget("admin")).toBe(true);
    expect(isPrivilegedTarget("fleet_manager")).toBe(false);
  });
});

describe("SA-RBAC sensitive settings separation", () => {
  it.each(["/system/health", "/system/errors", "/system/audit"])(
    "SA-RBAC-011/012/013: %s is super_admin-only in NAV_ROLES",
    (href) => {
      expect(NAV_ROLES[href]).toEqual(["super_admin"]);
    }
  );

  it.each(["/settings/api", "/settings/ai", "/settings/ai/logs"])(
    "SA-RBAC-014/015: %s is super_admin-only in NAV_ROLES",
    (href) => {
      expect(NAV_ROLES[href]).toEqual(["super_admin"]);
    }
  );

  it("keeps the /dispatch prefix gate when calendar is the default dispatch surface", () => {
    expect(NAV_ROLES["/dispatch"]).toEqual([
      "admin",
      "super_admin",
      "fleet_manager",
      "dispatcher",
    ]);
    expect(NAV_ROLES["/dispatch/calendar"]).toEqual([
      "admin",
      "super_admin",
      "fleet_manager",
      "dispatcher",
    ]);
  });

  it("ai_settings and system are super_admin-only in the matrix", () => {
    expect(rolesFor("ai_settings", "read")).toEqual(["super_admin"]);
    expect(rolesFor("ai_settings", "update")).toEqual(["super_admin"]);
    expect(rolesFor("system", "read")).toEqual(["super_admin"]);
  });

  it("SA-RBAC-016/017: admin retains operational settings and fleet access", () => {
    expect(rolesFor("dispatch_settings", "update")).toContain("admin");
    expect(rolesFor("uvvrp", "update")).toContain("admin");
    expect(rolesFor("vehicles", "create")).toContain("admin");
    expect(rolesFor("dispatch", "create")).toContain("admin");
    expect(rolesFor("ai", "read")).toContain("admin");
  });
});
