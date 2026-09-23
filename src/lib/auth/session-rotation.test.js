import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode } from "next-auth/jwt";

const insertMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
vi.mock("@/lib/db", () => ({
  query: (...args) => insertMock(...args),
}));

import { mintRotatedSession, sessionCookieName } from "./session-rotation";

const EMPLOYEE = {
  employeeId: 7,
  email: "ada@fleetops.example",
  firstName: "Ada",
  lastName: "Lovelace",
  position: "Dispatcher",
  status: "Active",
  role: "dispatcher",
  authVersion: 3,
};

let originalSecret;
let originalNodeEnv;

beforeEach(() => {
  originalSecret = process.env.NEXTAUTH_SECRET;
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NEXTAUTH_SECRET = "unit-test-secret-not-production";
  insertMock.mockClear();
  insertMock.mockResolvedValue({ rows: [], rowCount: 1 });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
  process.env.NODE_ENV = originalNodeEnv;
});

describe("sessionCookieName", () => {
  it("uses the __Secure- prefix only in production", () => {
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe("__Secure-next-auth.session-token");
    expect(sessionCookieName({ NODE_ENV: "development" })).toBe("next-auth.session-token");
    expect(sessionCookieName({ NODE_ENV: "test" })).toBe("next-auth.session-token");
  });
});

describe("mintRotatedSession", () => {
  it("inserts a web_sessions row with the canonical TTL and idle policy", async () => {
    await mintRotatedSession({ employee: EMPLOYEE, ip: "203.0.113.7", userAgent: "vitest" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const [sql, params] = insertMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO web_sessions");
    expect(params[1]).toBe(7);
    expect(params[2]).toBe(43200); // WEB_SESSION_TTL_SECONDS (12h)
    expect(params[3]).toBe("203.0.113.7");
    expect(params[4]).toBe("vitest");
    expect(params[5]).toBe(300); // IDLE_TIMEOUT_SECONDS (5 min)
  });

  it("round-trips a rotated cookie through decode with the forced-change flag cleared", async () => {
    const { cookie, sessionId, token } = await mintRotatedSession({
      employee: EMPLOYEE,
      ip: null,
      userAgent: null,
    });

    expect(cookie).toContain("next-auth.session-token=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=43200");
    expect(cookie).not.toMatch(/Secure/); // NODE_ENV=test → not production

    const encoded = cookie.split("next-auth.session-token=")[1].split(";")[0];
    const decoded = await decode({
      token: encoded,
      secret: process.env.NEXTAUTH_SECRET,
    });

    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.employeeId).toBe(7);
    expect(decoded.authVersion).toBe(3);
    expect(decoded.role).toBe("dispatcher");
    expect(decoded.name).toBe("Ada Lovelace");
    expect(decoded.email).toBe("ada@fleetops.example");
    expect(decoded.mustChangePassword).toBe(false);
    expect(token.mustChangePassword).toBe(false);
    // No credential material ever rides in the token (the boolean flag is fine).
    expect(JSON.stringify(decoded)).not.toMatch(/\$2b\$/);
    expect(JSON.stringify(decoded)).not.toMatch(/"(password|passwordHash|password_hash|newPassword|currentPassword|tempPassword)"\s*:/i);
  });

  it("propagates an insert failure instead of minting an unbacked session", async () => {
    insertMock.mockRejectedValueOnce(new Error("insert failed"));
    await expect(
      mintRotatedSession({ employee: EMPLOYEE, ip: null, userAgent: null })
    ).rejects.toThrow("insert failed");
  });
});
