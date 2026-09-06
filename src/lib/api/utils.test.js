// Unit tests for the Pass 1a handleError contract (src/lib/api/utils.js).
//
// Locked expectations:
//   AuthError                              → original 4xx, ZERO app_errors rows
//   unexpected error                       → 500 + exactly 1 app_errors row
//   logging DB failure                     → still the original 500, no throw
//   subsystemOwned-marked error            → 500 + zero app_errors rows
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as db from "@/lib/db";
import { AuthError, handleError } from "@/lib/api/utils";
import { markSubsystemOwned } from "@/lib/app-errors";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("handleError", () => {
  let querySpy;
  let consoleSpy;

  beforeEach(() => {
    querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ error_id: 1 }] });
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AuthError keeps its status and writes zero app_errors rows", async () => {
    const res = handleError(new AuthError("Session expired.", 401, "SESSION_EXPIRED"));
    expect(res.status).toBe(401);
    await flush();
    const appErrorWrites = querySpy.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO app_errors")
    );
    expect(appErrorWrites).toHaveLength(0);
  });

  it("unexpected error returns 500 and persists exactly one row", async () => {
    const err = new TypeError("Cannot read properties of undefined");
    const res = handleError(err, { req: { url: "http://x/api/ai/report-narrative", headers: { get: () => null } } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    await flush();
    const appErrorWrites = querySpy.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO app_errors")
    );
    expect(appErrorWrites).toHaveLength(1);
    const params = appErrorWrites[0][1];
    // params: source, route, message, stack, status, employee, fingerprint, ua
    expect(params[0]).toBe("server");
    expect(params[1]).toBe("/api/ai/report-narrative");
  });

  it("logging DB failure still returns the original 500 without throwing", async () => {
    querySpy.mockRejectedValue(new Error("connection lost"));
    let res;
    expect(() => {
      res = handleError(new Error("boom"));
    }).not.toThrow();
    expect(res.status).toBe(500);
    await flush();
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  it("subsystemOwned-marked error returns 500 with zero app_errors rows", async () => {
    const err = new Error("Gemini request timed out");
    markSubsystemOwned(err, "AI_TIMEOUT");
    const res = handleError(err);
    expect(res.status).toBe(500);
    await flush();
    const appErrorWrites = querySpy.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO app_errors")
    );
    expect(appErrorWrites).toHaveLength(0);
  });

  it("keeps the legacy string context as an operation label", async () => {
    const res = handleError(new Error("x"), "Failed to scan document");
    expect(res.status).toBe(500);
    await flush();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
