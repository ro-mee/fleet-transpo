// Pass 2 test: the /system/errors surface stays wired to system_admin-only
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

describe("/system/errors access contract", () => {
  it("is system_admin-only in NAV_ROLES", () => {
    expect(NAV_ROLES["/system/errors"]).toEqual(["system_admin"]);
  });

  it("appears in the system_admin sidebar under Administration", () => {
    const hrefs = collectHrefs(WORKS.system_admin.nav);
    expect(hrefs).toContain("/system/errors");
    expect(hrefs).toContain("/system/audit");
  });

  it("is hidden from every other workspace", () => {
    for (const [role, work] of Object.entries(WORKS)) {
      if (role === "system_admin") continue;
      expect(collectHrefs(work.nav)).not.toContain("/system/errors");
    }
  });
});
