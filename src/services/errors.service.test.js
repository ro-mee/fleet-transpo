// Pass 2 tests: errors.service client (never-rejecting reporter + query building).
import { describe, it, expect, vi, afterEach } from "vitest";
import { getAppErrors, getAppError, reportAppError } from "./errors.service";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOnce(payload, ok = true, status = 200) {
  const json = async () => payload;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status, statusText: "err", json }));
}

describe("getAppErrors", () => {
  it("builds the query string from filters", async () => {
    mockFetchOnce({ events: [], groups: [], total: 0 });
    await getAppErrors({ source: "mobile", limit: 50 });
    const url = fetch.mock.calls[0][0];
    expect(url).toContain("/api/errors?");
    expect(url).toContain("source=mobile");
    expect(url).toContain("limit=50");
  });
});

describe("getAppError", () => {
  it("fetches single-row detail by id", async () => {
    mockFetchOnce({ event: { error_id: 3 } });
    const res = await getAppError(3);
    expect(fetch.mock.calls[0][0]).toBe("/api/errors?error_id=3");
    expect(res.event.error_id).toBe(3);
  });
});

describe("reportAppError", () => {
  it("POSTs the report and returns the receipt", async () => {
    mockFetchOnce({ received: true, error_id: 9 });
    const res = await reportAppError({
      source: "web",
      route: "/dashboard",
      message: "boom",
      stack: "Error: boom",
    });
    expect(fetch.mock.calls[0][0]).toBe("/api/errors");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(res).toEqual({ received: true, error_id: 9 });
  });

  it("never rejects when the network fails (no reporter retry loop)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      reportAppError({ source: "mobile", route: null, message: "boom", stack: null })
    ).resolves.toEqual({ received: false });
  });

  it("never rejects on HTTP errors either", async () => {
    mockFetchOnce({ error: "Too many requests" }, false, 429);
    await expect(
      reportAppError({ source: "web", route: "/x", message: "boom", stack: null })
    ).resolves.toEqual({ received: false });
  });
});
