import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_IDS } from "@/lib/constants";
import { handleError } from "@/lib/api/utils";
import { rolesFor } from "@/lib/auth/permissions";
import { canAssignRole } from "@/app/api/auth/register/route";
import { proxy } from "@/proxy";
import { clientIp } from "@/lib/rate-limit";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

describe("security boundaries", () => {
  it("prevents admin privilege escalation", () => {
    expect(canAssignRole("admin", ROLE_IDS.system_admin)).toBe(false);
    expect(canAssignRole("system_admin", ROLE_IDS.system_admin)).toBe(true);
  });

  it("derives server role lists from the RBAC matrix", () => {
    expect(rolesFor("reports", "read")).toEqual([
      "system_admin", "admin", "fleet_manager", "management",
    ]);
    expect(rolesFor("maintenance", "create")).not.toContain("driver");
    expect(rolesFor("ai", "read")).not.toContain("driver");
    expect(rolesFor("accounts", "update")).toEqual(["system_admin", "admin"]);
    expect(rolesFor("dispatch_settings", "read")).toEqual([
      "system_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("reservations", "recommend")).toEqual([
      "system_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("drivers", "manage_account")).toEqual([
      "system_admin", "admin", "fleet_manager",
    ]);
    expect(rolesFor("ai", "scan_document")).toEqual([
      "system_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("fuel_requests", "read")).toEqual([
      "system_admin", "admin", "fleet_manager", "driver",
    ]);
    expect(rolesFor("fuel", "read_all")).toEqual([
      "system_admin", "admin", "fleet_manager", "dispatcher", "management",
    ]);
    expect(rolesFor("notifications", "read")).toEqual([
      "system_admin", "admin", "fleet_manager", "dispatcher", "driver", "management",
    ]);
  });

  it("keeps page guards on the shared path policy", () => {
    const source = readFileSync(new URL("./lib/auth/role-guard.js", import.meta.url), "utf8");
    expect(source).toContain("getRequiredRolesForPath(pathname)");
    expect(source).not.toContain("useRequireRole(requiredRoles)");
  });

  it("keeps employee response projections explicit", () => {
    const auditedRoutes = [
      "./app/api/fuel/route.js",
      "./app/api/fuel/[id]/route.js",
      "./app/api/ai/recommendations/route.js",
    ];
    for (const path of auditedRoutes) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/row_to_json\(e\.\*\)/);
      expect(source).not.toMatch(/e\.password_hash/);
    }
  });

  it("keeps drivers on dedicated, scoped fleet endpoints", () => {
    const listRoutes = [
      "./app/api/trips/route.js",
      "./app/api/dispatch/route.js",
      "./app/api/vehicles/route.js",
    ];
    for (const path of listRoutes) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toContain('"management", "driver"');
    }
    const searchSource = readFileSync(new URL("./app/api/search/route.js", import.meta.url), "utf8");
    expect(searchSource).not.toContain('requireAuth(req, "*")');
  });

  it("does not expose unexpected server errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = handleError(new Error("DATABASE_URL contains a secret"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("allows only the configured browser origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fleet.example.com/app";

    const denied = proxy(new Request("https://fleet.example.com/api/vehicles", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const allowed = proxy(new Request("https://fleet.example.com/api/vehicles", {
      method: "OPTIONS",
      headers: { Origin: "https://fleet.example.com" },
    }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://fleet.example.com");
  });

  it("rate-limit IP keys use the rightmost (proxy-added) x-forwarded-for hop", () => {
    const spoofable = { headers: new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.9, 203.0.113.7" }) };
    expect(clientIp(spoofable)).toBe("203.0.113.7");

    const direct = { headers: new Headers({ "x-forwarded-for": "198.51.100.2" }) };
    expect(clientIp(direct)).toBe("198.51.100.2");

    const realIp = { headers: new Headers({ "x-real-ip": "198.51.100.3" }) };
    expect(clientIp(realIp)).toBe("198.51.100.3");

    const garbage = { headers: new Headers({ "x-forwarded-for": "not an ip" }) };
    expect(clientIp(garbage)).toBe("unknown");

    expect(clientIp({ headers: new Headers() })).toBe("unknown");
  });

  it("server-side media fetches are restricted to fleet-controlled origins", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const { isSafeRemoteMediaUrl } = await import("@/lib/security/remote-url");

    expect(isSafeRemoteMediaUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeRemoteMediaUrl("https://proj.supabase.co/storage/v1/object/sign/docs/a.png?token=x")).toBe(true);
    expect(isSafeRemoteMediaUrl("http://localhost:3000/uploads/a.png")).toBe(true);

    expect(isSafeRemoteMediaUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeRemoteMediaUrl("http://127.0.0.1:8080/admin")).toBe(false);
    expect(isSafeRemoteMediaUrl("https://evil.example/a.png")).toBe(false);
    expect(isSafeRemoteMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeRemoteMediaUrl("https://user:pass@proj.supabase.co/a.png")).toBe(false);
    expect(isSafeRemoteMediaUrl(null)).toBe(false);
  });
});
