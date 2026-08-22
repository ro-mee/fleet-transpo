import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLE_IDS } from "@/lib/constants";
import { handleError } from "@/lib/api/utils";
import { canAssignRole } from "@/app/api/auth/register/route";
import { proxy } from "@/proxy";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("security boundaries", () => {
  it("prevents admin privilege escalation", () => {
    expect(canAssignRole("admin", ROLE_IDS.system_admin)).toBe(false);
    expect(canAssignRole("system_admin", ROLE_IDS.system_admin)).toBe(true);
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
});
