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
    expect(canAssignRole("admin", ROLE_IDS.super_admin)).toBe(false);
    expect(canAssignRole("admin", ROLE_IDS.admin)).toBe(false);
    expect(canAssignRole("super_admin", ROLE_IDS.super_admin)).toBe(true);
    expect(canAssignRole("super_admin", ROLE_IDS.admin)).toBe(true);
  });

  it("derives server role lists from the RBAC matrix", () => {
    expect(rolesFor("reports", "read")).toEqual([
      "super_admin", "admin", "fleet_manager", "management",
    ]);
    expect(rolesFor("maintenance", "create")).not.toContain("driver");
    expect(rolesFor("ai", "read")).not.toContain("driver");
    expect(rolesFor("accounts", "update")).toEqual(["super_admin", "admin"]);
    expect(rolesFor("dispatch_settings", "read")).toEqual([
      "super_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("reservations", "recommend")).toEqual([
      "super_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("drivers", "manage_account")).toEqual([
      "super_admin", "admin", "fleet_manager",
    ]);
    expect(rolesFor("ai", "scan_document")).toEqual([
      "super_admin", "admin", "fleet_manager", "dispatcher",
    ]);
    expect(rolesFor("fuel_requests", "read")).toEqual([
      "super_admin", "admin", "fleet_manager", "driver",
    ]);
    expect(rolesFor("fuel", "read_all")).toEqual([
      "super_admin", "admin", "fleet_manager", "dispatcher", "management",
    ]);
    expect(rolesFor("notifications", "read")).toEqual([
      "super_admin", "admin", "fleet_manager", "dispatcher", "driver", "management",
    ]);
  });

  it("keeps page guards on the shared path policy", () => {
    const source = readFileSync(new URL("./lib/auth/role-guard.js", import.meta.url), "utf8");
    expect(source).toContain("getRequiredRolesForPath(pathname)");
    expect(source).not.toContain("useRequireRole(requiredRoles)");
  });

  // The idle timeout is only real if `last_seen_at` moves solely through the
  // human-gated heartbeat. resolveCurrentIdentity() used to slide it on any
  // authenticated request older than 5 minutes, which meant the dashboard's
  // background polling (sidebar counts every 30s, live map every 15-30s) kept
  // an abandoned browser alive forever and the idle timeout never fired.
  // Removing that write is the fix; this guard keeps it removed.
  it("keeps identity resolution read-only for session timing", () => {
    const source = readFileSync(new URL("./lib/api/utils.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/UPDATE\s+web_sessions\s+SET\s+last_seen_at/i);
    // Only the heartbeat route may slide the deadline.
    expect(source).not.toMatch(/last_seen_at\s*=\s*NOW\(\)/i);
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

  it("allows only the configured browser origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fleet.example.com/app";

    const denied = proxy(new Request("https://fleet.example.com/api/vehicles", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    // Disallowed origin on non-OPTIONS request returns JSON so client .json() does not throw Unexpected end of JSON
    const deniedPost = proxy(new Request("https://fleet.example.com/api/auth/callback/credentials", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }));
    expect(deniedPost.status).toBe(403);
    const deniedJson = await deniedPost.json();
    expect(deniedJson).toEqual({ error: "Forbidden: origin not allowed" });

    const allowed = proxy(new Request("https://fleet.example.com/api/vehicles", {
      method: "OPTIONS",
      headers: { Origin: "https://fleet.example.com" },
    }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://fleet.example.com");

    // In production, same-origin POST requests with Origin header (standard browser behavior) are allowed
    const sameOriginPost = proxy(new Request("https://fleet.example.com/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        Origin: "https://fleet.example.com",
        Host: "fleet.example.com",
      },
    }));
    expect(sameOriginPost.status).toBe(200);
    expect(sameOriginPost.headers.get("access-control-allow-origin")).toBe("https://fleet.example.com");
  });

  it("allows development loopback and LAN origins when configured for localhost", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const localAllowed = proxy(new Request("http://localhost:3000/api/auth/session", {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:3000" },
    }));
    expect(localAllowed.status).toBe(204);
    expect(localAllowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");

    const lanAllowed = proxy(new Request("http://localhost:3000/api/auth/session", {
      method: "OPTIONS",
      headers: { Origin: "http://192.168.1.5:3000" },
    }));
    expect(lanAllowed.status).toBe(204);
    expect(lanAllowed.headers.get("access-control-allow-origin")).toBe("http://192.168.1.5:3000");

    const evilDenied = proxy(new Request("http://localhost:3000/api/auth/session", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.com:3000" },
    }));
    expect(evilDenied.status).toBe(403);

    process.env.NODE_ENV = originalEnv;
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

  // The temp-password invite flow: the admin never supplies or sees a
  // password, the server marks the row for a forced first-login change, and
  // a failed invite email removes the row again (fail closed).
  it("register invites: fail closed, no client password field", () => {
    const route = readFileSync(new URL("./app/api/auth/register/route.js", import.meta.url), "utf8");
    expect(route).toContain("sendTempPasswordEmail");
    expect(route).toContain("must_change_password");
    expect(route).toMatch(/DELETE FROM employees/);
    expect(route).not.toContain('type: "password"');
    expect(route).toContain("isDeliverableEmailAddress");

    const page = readFileSync(new URL("./app/(dashboard)/settings/users/new/page.js", import.meta.url), "utf8");
    expect(page).not.toMatch(/type="password"/);
    expect(page).not.toContain("showPassword");
    expect(page).not.toContain('register("password")');
  });

  // Expired temporary passwords must die at the login gate (before any OTP
  // email), and the must-change claim has to travel authorize → token →
  // session so the forced-change redirect can fire.
  it("login rejects expired temp passwords and carries the mustChangePassword claim", () => {
    const authSource = readFileSync(new URL("./lib/auth.js", import.meta.url), "utf8");
    expect(authSource).toContain("TEMP_PASSWORD_EXPIRED");
    expect(authSource).toContain("must_change_password");
    expect(authSource).toContain("temp_credential_expires_at");
    expect(authSource).toMatch(/mustChangePassword:\s*Boolean\(employee\.must_change_password\)/);
    expect(authSource).toMatch(/token\.mustChangePassword\s*=\s*Boolean\(user\.mustChangePassword\)/);
    expect(authSource).toMatch(/session\.user\.mustChangePassword\s*=\s*Boolean\(token\.mustChangePassword\)/);
    // Expiry must be checked before the OTP block so no code is emailed.
    const expiryAt = authSource.indexOf("TEMP_PASSWORD_EXPIRED");
    const otpAt = authSource.indexOf("await issueLoginChallenge"); // call site, not the import
    expect(expiryAt).toBeGreaterThan(-1);
    expect(otpAt).toBeGreaterThan(expiryAt);

    const login = readFileSync(new URL("./app/(auth)/login/page.js", import.meta.url), "utf8");
    expect(login).toContain("TEMP_PASSWORD_EXPIRED");
    expect(login).toContain("/set-password");
    expect(login).toMatch(/mustChangePassword/);
  });

  // The UI redirect is only a hint: resolveIdentity itself must refuse every
  // non-allowlisted call for a session that still holds a temporary password.
  it("gates must-change sessions server-side with PASSWORD_CHANGE_REQUIRED", () => {
    const source = readFileSync(new URL("./lib/api/utils.js", import.meta.url), "utf8");
    expect(source).toContain("PASSWORD_CHANGE_REQUIRED");
    expect(source).toContain('"/api/auth/change-password"');
    expect(source).toContain('"/api/auth/profile"');
    expect(source).toContain('"/api/auth/heartbeat"');
    expect(source).toMatch(/assertPasswordChangeGate\(req, user\)/g);
    expect(source).toContain("must_change_password");
    // Both auth schemes must pass through the gate (definition + 2 call sites).
    expect(source.match(/assertPasswordChangeGate\(req, user\)/g)).toHaveLength(3);
  });

  // Forced first-login change = rotate-and-stay (fresh cookie in the response);
  // the voluntary Settings path must keep its legacy signInRequired sign-out.
  it("change-password rotates the session only on the forced path", () => {
    const source = readFileSync(new URL("./app/api/auth/change-password/route.js", import.meta.url), "utf8");
    expect(source).toMatch(/must_change_password = false/);
    expect(source).toMatch(/temp_credential_expires_at = NULL/);
    expect(source).toContain("mintRotatedSession");
    expect(source).toContain("revokeEmployeeSessions");
    expect(source).toContain('signInRequired: true'); // voluntary path unchanged
    expect(source).not.toMatch(/newValues:\s*\{[^}]*password/);
  });
});
