// Tests for the bearer token-family liveness check in resolveIdentity
// (src/lib/api/utils.js).
//
// Regression pin for the 2026-09-08 401 SESSION_REVOKED storm: the family
// check ran `LIMIT 1` without ORDER BY and without `revoked_at IS NULL`, so
// after ANY refresh rotation (family = one rotation-revoked old row + one
// active new row) it returned the old revoked row and rejected every valid
// access token. The driver saw "Session revoked." on every screen while the
// refresh endpoint kept returning 200 — a lying server, a healthy client.
//
// The family-liveness invariant (maintained by the refresh route): a family
// is alive iff it has a non-revoked row. Rotation = revoke-all + insert one
// active; whole-family revocation (replay, logout, admin revoke) leaves none.
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveIdentity, AuthError } from "@/lib/api/utils";
import * as db from "@/lib/db";
import * as mobileToken from "@/lib/auth/mobile-token";
import * as nextAuth from "@/lib/auth";

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPLOYEE = {
  employee_id: 41,
  email: "driver@example.com",
  first_name: "Test",
  last_name: "Driver",
  position: "Driver",
  status: "Active",
  auth_version: 1,
  role_name: "driver",
  driver_id: 7,
};

const TOKEN = "valid-access-token";

function mockBearerIdentity() {
  vi.spyOn(mobileToken, "extractBearerToken").mockReturnValue(TOKEN);
  vi.spyOn(mobileToken, "verifyAccessToken").mockResolvedValue({
    employeeId: 41,
    role: "driver",
    driverId: 7,
    authVersion: 1,
    familyId: "fam-1",
  });
}

function mockReq() {
  return {
    url: "http://x/api/mobile/driver/trips",
    headers: {
      get: (name) =>
        name === "authorization" ? `Bearer ${TOKEN}` : null,
    },
  };
}

/**
 * Scripts db.query: the employees SELECT always resolves; the family SELECT
 * returns `familyRows` (order matters for the buggy query, so the test feeds
 * the shape the DB actually returns — oldest row first).
 */
function mockDb({ familyRows }) {
  const querySpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM employees e")) return { rows: [EMPLOYEE] };
    if (sql.includes("FROM mobile_refresh_tokens")) return { rows: familyRows };
    return { rows: [] };
  });
  return querySpy;
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe("bearer token-family liveness check", () => {
  it("accepts a family that has been rotated (revoked old row + active new row)", async () => {
    // The exact poisoned state after one refresh rotation. Pre-fix, the
    // unordered LIMIT 1 picked the revoked row → SESSION_REVOKED.
    mockBearerIdentity();
    mockDb({
      familyRows: [
        { revoked_at: PAST, expires_at: FUTURE }, // old, revoked by rotation
        { revoked_at: null, expires_at: FUTURE }, // current active row
      ],
    });

    const session = await resolveIdentity(mockReq());
    expect(session.via).toBe("bearer");
    expect(session.user.employeeId).toBe(41);
    expect(session.user.driverId).toBe(7);
  });

  it("throws SESSION_REVOKED when the whole family is revoked", async () => {
    // Whole-family revocation (replay detection, logout, admin revoke) leaves
    // no active row: the query's revoked_at IS NULL filter yields nothing.
    // NOTE: a revoked family and a never-existing family are deliberately
    // indistinguishable here — both are zero-row results taking the same
    // unrecoverable-session path. Nothing downstream needs to tell them apart.
    mockBearerIdentity();
    mockDb({ familyRows: [] });

    await expect(resolveIdentity(mockReq())).rejects.toMatchObject({
      status: 401,
      code: "SESSION_REVOKED",
      message: "Session revoked.",
    });
  });

  it("throws SESSION_EXPIRED when the active row's family is past expiry", async () => {
    mockBearerIdentity();
    mockDb({
      familyRows: [{ revoked_at: null, expires_at: PAST }],
    });

    await expect(resolveIdentity(mockReq())).rejects.toMatchObject({
      status: 401,
      code: "SESSION_EXPIRED",
    });
  });

  it("maps a never-existing family to the same SESSION_REVOKED path as a revoked one", async () => {
    // Both are zero-row results from the one query; no separate check
    // distinguishes them, and none is needed — both are unrecoverable.
    mockBearerIdentity();
    const querySpy = mockDb({ familyRows: [] });
    querySpy.mockImplementation(async (sql) => {
      if (sql.includes("FROM employees e")) return { rows: [EMPLOYEE] };
      return { rows: [] };
    });

    await expect(resolveIdentity(mockReq())).rejects.toMatchObject({
      status: 401,
      code: "SESSION_REVOKED",
    });
  });

  it("queries the ACTIVE row deterministically — revoked_at IS NULL, ORDER BY created_at DESC", async () => {
    // Pins the query shape (the resolveDriverId lesson: pin what the code
    // actually sends, not what you imagine it sends).
    mockBearerIdentity();
    const querySpy = mockDb({ familyRows: [{ revoked_at: null, expires_at: FUTURE }] });

    await resolveIdentity(mockReq());
    const familySql = querySpy.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("FROM mobile_refresh_tokens"));
    expect(familySql).toContain("revoked_at IS NULL");
    expect(familySql).toContain("ORDER BY created_at DESC");
  });
});
