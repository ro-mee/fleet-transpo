// Unit tests for the Pass 1a ownership foundation (src/lib/app-errors.js).
//
// Locked contract under test:
//   subsystemOwned === true            → skip app_errors (proof of persistence)
//   known subsystem code WITHOUT mark  → capture (fallback, never lose errors)
//   unmarked TypeError inside /api/ai/* → capture
import { describe, it, expect, vi, afterEach } from "vitest";
import * as db from "@/lib/db";
import {
  SUBSYSTEM_OWNED_CODES,
  sanitizeErrorText,
  normalizeErrorMessage,
  fingerprintError,
  markSubsystemOwned,
  shouldWriteAppError,
  normalizeContext,
  requestContext,
  writeAppError,
  pruneAppErrors,
} from "@/lib/app-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeErrorText", () => {
  it("redacts bearer tokens but keeps surrounding text", () => {
    const out = sanitizeErrorText("fetch failed: Bearer abc.def.ghi-jkl at endpoint");
    expect(out).toContain("Bearer [redacted]");
    expect(out).not.toContain("abc.def");
    expect(out).toContain("at endpoint");
  });

  it("redacts authorization and cookie header lines", () => {
    const out = sanitizeErrorText("headers:\nAuthorization: Basic c2VjcmV0\nCookie: session=abc123\nok");
    expect(out).toContain("Authorization: [redacted]");
    expect(out).toContain("Cookie: [redacted]");
    expect(out).not.toContain("c2VjcmV0");
    expect(out).not.toContain("session=abc123");
  });

  it("strips query strings and fragments from URLs, keeping origin + pathname", () => {
    const out = sanitizeErrorText("GET https://api.example.com/v1/x?token=abc&next=/y#frag failed");
    expect(out).toContain("https://api.example.com/v1/x");
    expect(out).not.toContain("token=abc");
    expect(out).not.toContain("#frag");
  });

  it("redacts standalone secret query params and secret assignments", () => {
    expect(sanitizeErrorText("callback ?token=abc123&mode=1")).toContain("?token=[redacted]");
    expect(sanitizeErrorText('config {"password": "hunter2"} saved')).toContain('"password": [redacted]');
    expect(sanitizeErrorText("api_key=AKIA12345 rejected")).toContain("api_key=[redacted]");
  });

  it("leaves ordinary prose untouched", () => {
    expect(sanitizeErrorText("password is required")).toBe("password is required");
    expect(sanitizeErrorText("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined"
    );
  });

  it("never throws on hostile input", () => {
    expect(() => sanitizeErrorText(null)).not.toThrow();
    expect(() => sanitizeErrorText(undefined)).not.toThrow();
  });
});

describe("normalizeErrorMessage + fingerprintError", () => {
  it("groups identical failures across ids and uuids", () => {
    const a = fingerprintError({
      source: "server",
      route: "/api/dispatch/assign",
      message: "Driver 42 not available for dispatch 581",
    });
    const b = fingerprintError({
      source: "server",
      route: "/api/dispatch/assign",
      message: "Driver 7 not available for dispatch 90412",
    });
    expect(a).toBe(b);
    expect(a).toContain("<n>");
  });

  it("groups across uuids and is case-insensitive", () => {
    const a = fingerprintError({
      source: "web",
      route: "/dashboard",
      message: "Failed job 3f6d8c2a-1b4e-4c9a-9f2d-7e6a5b4c3d2e retry",
    });
    const b = fingerprintError({
      source: "web",
      route: "/dashboard",
      message: "FAILED JOB 9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d retry",
    });
    expect(a).toBe(b);
  });

  it("separates different sources, routes, and messages", () => {
    const base = { route: "/api/x", message: "boom" };
    expect(fingerprintError({ ...base, source: "server" })).not.toBe(
      fingerprintError({ ...base, source: "web" })
    );
    expect(
      fingerprintError({ source: "server", route: "/api/a", message: "boom" })
    ).not.toBe(fingerprintError({ source: "server", route: "/api/b", message: "boom" }));
  });

  it("falls back safely on empty input", () => {
    expect(fingerprintError({})).toBe("server|unknown-route|unknown error");
    expect(fingerprintError()).toBe("server|unknown-route|unknown error");
  });
});

describe("ownership gate", () => {
  it("exposes the AI classification registry", () => {
    for (const code of ["AI_PROVIDER_ERROR", "AI_RATE_LIMIT", "AI_TIMEOUT", "AI_PARSE_FAILURE", "AI_GENERATION_FAILURE"]) {
      expect(SUBSYSTEM_OWNED_CODES.has(code)).toBe(true);
    }
  });

  it("owned AI error (marker set after successful ailogs write) → skip", () => {
    const err = new Error("Gemini request timed out");
    err.code = "AI_TIMEOUT";
    markSubsystemOwned(err, "AI_TIMEOUT");
    expect(err.subsystemOwned).toBe(true);
    expect(shouldWriteAppError(err)).toBe(false);
  });

  it("AI error + ailogs write failure (code but NO marker) → capture as fallback", () => {
    const err = new Error("Gemini request timed out");
    err.code = "AI_TIMEOUT";
    expect(shouldWriteAppError(err)).toBe(true);
  });

  it("unmarked TypeError inside /api/ai/* → capture", () => {
    const err = new TypeError("Cannot read properties of undefined");
    expect(shouldWriteAppError(err)).toBe(true);
  });

  it("plain and nullish errors → capture, never throw", () => {
    expect(shouldWriteAppError(new Error("boom"))).toBe(true);
    expect(shouldWriteAppError(null)).toBe(true);
    expect(shouldWriteAppError(undefined)).toBe(true);
  });

  it("markSubsystemOwned returns the error for chaining and tolerates junk", () => {
    const err = new Error("x");
    expect(markSubsystemOwned(err)).toBe(err);
    expect(() => markSubsystemOwned(null)).not.toThrow();
  });
});

describe("normalizeContext + requestContext", () => {
  it("keeps the 11 existing string labels as { operation }", () => {
    expect(normalizeContext("Failed to scan document")).toEqual({
      operation: "Failed to scan document",
    });
  });

  it("passes objects through and blanks the rest", () => {
    const ctx = { req: {}, employeeId: 8 };
    expect(normalizeContext(ctx)).toBe(ctx);
    expect(normalizeContext()).toEqual({});
    expect(normalizeContext(42)).toEqual({});
  });

  it("derives pathname-only route + user-agent without auth", () => {
    const req = {
      url: "http://localhost:3000/api/dispatch/assign?token=secret&id=5",
      headers: { get: (k) => (k === "user-agent" ? "Mozilla/5.0" : null) },
    };
    const ctx = requestContext(req);
    expect(ctx.route).toBe("/api/dispatch/assign");
    expect(ctx.userAgent).toBe("Mozilla/5.0");
  });

  it("supports plain-object headers and never invents values", () => {
    expect(requestContext({ url: "http://x/y", headers: { "user-agent": "Expo/1" } })).toEqual({
      route: "/y",
      userAgent: "Expo/1",
    });
    expect(requestContext(null)).toEqual({});
    expect(requestContext({})).toEqual({});
  });
});

describe("writeAppError", () => {
  it("persists sanitized, truncated values with a fingerprint", async () => {
    const spy = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ error_id: 1 }] });
    const res = await writeAppError({
      source: "web",
      route: "/dashboard",
      message: "Crash with Bearer abc.def.ghi inside",
      stack: "Error\n    at x (https://cdn/a.js?k=1)",
      statusCode: null,
      employeeId: "8",
      userAgent: "Mozilla/5.0",
    });
    expect(res).toEqual({ error_id: 1 });
    const [sql, params] = spy.mock.calls[0];
    expect(sql).toContain("INSERT INTO app_errors");
    const [source, route, message, stack, status, emp, fp, ua] = params;
    expect(source).toBe("web");
    expect(route).toBe("/dashboard");
    expect(message).toContain("Bearer [redacted]");
    expect(message).not.toContain("abc.def");
    expect(stack).not.toContain("?k=1");
    expect(status).toBeNull();
    expect(emp).toBe(8);
    expect(typeof fp).toBe("string");
    expect(ua).toBe("Mozilla/5.0");
  });

  it("resolves null (never throws) when the DB write fails", async () => {
    vi.spyOn(db, "query").mockRejectedValue(new Error("connection lost"));
    await expect(
      writeAppError({ source: "server", message: "boom" })
    ).resolves.toBeNull();
  });
});

describe("pruneAppErrors", () => {
  it("returns the deleted count", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rowCount: 12 });
    await expect(pruneAppErrors({ olderThanDays: 90 })).resolves.toEqual({ deleted: 12 });
  });

  it("resolves { deleted: 0 } (never throws) when pruning fails", async () => {
    vi.spyOn(db, "query").mockRejectedValue(new Error("connection lost"));
    await expect(pruneAppErrors()).resolves.toEqual({ deleted: 0 });
  });
});
