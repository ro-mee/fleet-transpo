import { describe, it, expect } from "vitest";
import { NAV_ROLES } from "@/lib/auth/permissions";
import { WORKS } from "@/lib/workspaces";

const EXPECTED_OPERATIONS_ROUTES = [
  "/fleet/vehicles",
  "/drivers",
  "/drivers/leave",
  "/fleet/assignments",
  "/drivers/performance",
  "/reservations",
  "/reservations/queue",
  "/dispatch/calendar",
  "/trips",
  "/routes",
  "/incidents",
  "/fuel",
  "/maintenance",
  "/tracking/live-map",
  "/uvvrp",
  "/reports",
  "/analytics",
];

describe("Super Admin Navigation Structure Contract", () => {
  const superAdminNav = WORKS.super_admin.nav;

  it("only Operations has children in Super Admin sidebar", () => {
    const itemsWithChildren = [];
    superAdminNav.forEach((group) => {
      (group.items || []).forEach((item) => {
        if (item.children && item.children.length > 0) {
          itemsWithChildren.push(item);
        }
      });
    });

    expect(itemsWithChildren).toHaveLength(1);
    expect(itemsWithChildren[0].label).toBe("Operations");
    expect(itemsWithChildren[0].href).toBe("/operations");
  });

  it("Operations contains all 17 operational routes in exact order", () => {
    const operationsGroup = superAdminNav.find((group) => group.label === "Operations");
    expect(operationsGroup).toBeDefined();

    const operationsItem = operationsGroup.items.find((item) => item.label === "Operations");
    expect(operationsItem).toBeDefined();
    expect(operationsItem.children).toHaveLength(17);

    const childHrefs = operationsItem.children.map((c) => c.href);
    expect(childHrefs).toEqual(EXPECTED_OPERATIONS_ROUTES);
  });

  it("User Management is a standalone item without children", () => {
    const securityGroup = superAdminNav.find((group) => group.label === "Security & Access");
    expect(securityGroup).toBeDefined();

    const userMgmtItem = securityGroup.items.find((item) => item.href === "/settings/users");
    expect(userMgmtItem).toBeDefined();
    expect(userMgmtItem.label).toBe("User Management");
    expect(userMgmtItem.children).toBeUndefined();
  });

  it("does not duplicate any operational route across Super Admin sidebar", () => {
    const topLevelHrefs = [];
    superAdminNav.forEach((group) => {
      (group.items || []).forEach((item) => {
        if (item.href) topLevelHrefs.push(item.href);
      });
    });

    for (const opRoute of EXPECTED_OPERATIONS_ROUTES) {
      expect(topLevelHrefs).not.toContain(opRoute);
    }
  });

  it("every operational child route permits super_admin in NAV_ROLES", () => {
    for (const opRoute of EXPECTED_OPERATIONS_ROUTES) {
      const allowed = NAV_ROLES[opRoute];
      expect(allowed).toBeDefined();
      expect(allowed).toContain("super_admin");
    }
  });

  it("AI Insights (/ai/insights) is removed from all role navigation lists", () => {
    function collectAllHrefs(items = []) {
      return items.flatMap((item) => [
        ...(item.href ? [item.href] : []),
        ...collectAllHrefs(item.items || []),
        ...collectAllHrefs(item.children || []),
      ]);
    }

    for (const [role, workspace] of Object.entries(WORKS)) {
      const hrefs = collectAllHrefs(workspace.nav);
      expect(hrefs, `Role ${role} should not contain /ai/insights`).not.toContain("/ai/insights");
    }
  });

  it("other workspaces (admin, fleet_manager, dispatcher, driver, management) are defined", () => {
    expect(WORKS.admin).toBeDefined();
    expect(WORKS.fleet_manager).toBeDefined();
    expect(WORKS.dispatcher).toBeDefined();
    expect(WORKS.driver).toBeDefined();
    expect(WORKS.management).toBeDefined();
  });
});
