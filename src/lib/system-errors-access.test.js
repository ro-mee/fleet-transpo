// Pass 2 + 3 tests: the /system/* surfaces stay wired to system_admin-only
// guards in all three places (route roles, sidebar nav, page guard reads
// roles from the path, so these two are the contract).
import { describe, it, expect } from "vitest";
import { NAV_ROLES } from "@/lib/auth/permissions";
import { WORKS } from "@/lib/workspaces";

function collectHrefs(items = []) {
  return items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...collectHrefs(item.items || []),
    ...collectHrefs(item.children || []),
  ]);
}

const SYSTEM_SURFACES = ["/system/health", "/system/audit", "/system/errors"];

describe("/system/* access contract", () => {
  it.each(SYSTEM_SURFACES)("%s is system_admin-only in NAV_ROLES", (href) => {
    expect(NAV_ROLES[href]).toEqual(["system_admin"]);
  });

  it("all three appear in the system_admin sidebar under Administration", () => {
    const hrefs = collectHrefs(WORKS.system_admin.nav);
    for (const href of SYSTEM_SURFACES) expect(hrefs).toContain(href);
  });

  it("all three are hidden from every other workspace", () => {
    for (const [role, work] of Object.entries(WORKS)) {
      if (role === "system_admin") continue;
      const hrefs = collectHrefs(work.nav);
      for (const href of SYSTEM_SURFACES) expect(hrefs).not.toContain(href);
    }
  });
});
