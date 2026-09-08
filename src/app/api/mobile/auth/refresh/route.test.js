// Tests for POST /api/mobile/auth/refresh rotation rules.
//
// Covers the forced-logout incident (driver report): the foreground poster
// and the background GPS task run in SEPARATE JS contexts with independent
// single-flight guards, so both can refresh one family concurrently. The
// ROTATION_COOLDOWN_SECONDS gate turns the loser away with a stateless 429
// instead of letting the two contexts alternate grace-rotations until one
// lands outside grace and the replay rule wipes the family.
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST, ROTATION_COOLDOWN_SECONDS } from "./route";
import * as db from "@/lib/db";
import * as mobileToken from "@/lib/auth/mobile-token";
import * as rateLimit from "@/lib/rate-limit";
import * as auditLog from "@/lib/audit";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockReq(body) {
  return {
    url: "http://x/api/mobile/auth/refresh",
    headers: { get: () => null },
    json: async () => body,
  };
}

function mockTokenLib() {
  vi.spyOn(mobileToken, "verifyRefreshToken").mockResolvedValue({
    employeeId: 41,
    familyId: "fam-1",
    authVersion: 1,
  });
  vi.spyOn(mobileToken, "hashToken").mockImplementation((t) => `hash:${t}`);
  vi.spyOn(mobileToken, "signAccessToken").mockResolvedValue("NEW-ACCESS");
  vi.spyOn(mobileToken, "signRefreshToken").mockResolvedValue({ token: "NEW-REFRESH" });
  vi.spyOn(rateLimit, "rateLimit").mockResolvedValue({ allowed: true, remaining: 19, retryAfter: 0 });
  vi.spyOn(auditLog, "writeAudit").mockResolvedValue();
}

/**
 * Run the route's transaction callback against scripted rows. Matchers map a
 * SQL substring to the rows returned, in call order per matcher.
 */
function mockTx(script) {
  const counters = new Map();
  const txQuery = vi.fn(async (sql) => {
    for (const [match, batches] of script) {
      if (sql.includes(match)) {
        const n = counters.get(match) || 0;
        counters.set(match, n + 1);
        return { rows: batches[Math.min(n, batches.length - 1)] };
      }
    }
    return { rows: [] };
  });
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => fn({ query: txQuery }));
  return txQuery;
}

const EXISTING = [{ employee_id: 41, family_id: "fam-1" }];
const EMPLOYEE = [{ employee_id: 41, auth_version: 1, role_name: "driver", driver_id: 7 }];

describe("rotation cooldown", () => {
  it("returns 429 with no writes when the family rotated seconds ago", async () => {
    expect(ROTATION_COOLDOWN_SECONDS).toBeGreaterThan(0);
    mockTokenLib();
    const txQuery = mockTx([
      ["token_hash = $1 AND employee_id", [EXISTING]],
      ["MAX(created_at)", [[{ last_rotation: new Date().toISOString() }]]],
    ]);

    const res = await POST(mockReq({ refreshToken: "OLD-R" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Too many requests/);
    expect(body.retry_after).toEqual(expect.any(Number));
    expect(body.retry_after).toBeGreaterThan(0);
    expect(body.retry_after).toBeLessThanOrEqual(ROTATION_COOLDOWN_SECONDS);
    const writes = txQuery.mock.calls.filter(([sql]) =>
      /UPDATE mobile_refresh_tokens|INSERT INTO mobile_refresh_tokens/.test(sql)
    );
    expect(writes).toHaveLength(0);
  });

  it("rate-limit 429 carries the limiter's retry_after without touching tokens", async () => {
    mockTokenLib();
    rateLimit.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 42 });
    const txQuery = mockTx([]);
    // withTransaction must never run: the gate fires before any DB work.
    const res = await POST(mockReq({ refreshToken: "OLD-R" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ retry_after: 42 });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("rotates normally once the cooldown has passed", async () => {
    mockTokenLib();
    const old = new Date(Date.now() - (ROTATION_COOLDOWN_SECONDS + 5) * 1000).toISOString();
    const txQuery = mockTx([
      ["token_hash = $1 AND employee_id", [EXISTING]],
      ["MAX(created_at)", [[{ last_rotation: old }]]],
      ["SET revoked_at = COALESCE", [[{ id: 1, family_id: "fam-1" }]]],
      ["FROM employees e", [EMPLOYEE]],
      ["INSERT INTO mobile_refresh_tokens", [[{ id: 2 }]]],
    ]);

    const res = await POST(mockReq({ refreshToken: "OLD-R" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accessToken: "NEW-ACCESS", refreshToken: "NEW-REFRESH" });
    expect(txQuery).toHaveBeenCalled();
  });

  it("still wipes the family on a genuine out-of-grace replay", async () => {    mockTokenLib();
    const old = new Date(Date.now() - (ROTATION_COOLDOWN_SECONDS + 5) * 1000).toISOString();
    mockTx([
      ["token_hash = $1 AND employee_id", [EXISTING]],
      ["MAX(created_at)", [[{ last_rotation: old }]]],
      // Revoke UPDATE matches nothing: token already dead outside grace.
      ["SET revoked_at = COALESCE", [[]]],
    ]);

    const res = await POST(mockReq({ refreshToken: "STALE-R" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Refresh token has been revoked or already used" });
    expect(auditLog.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ action: "refresh_reuse" })
    );
  });
});
