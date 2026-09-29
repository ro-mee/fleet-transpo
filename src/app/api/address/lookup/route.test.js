import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as apiUtils from "@/lib/api/utils";
import * as rateLimits from "@/lib/rate-limit";

const QUERY = "29 Ninang Virginia, Barangay 169, City of Caloocan, Philippines";

function request(body) {
  return { json: async () => body };
}

beforeEach(() => {
  process.env.TOMTOM_API_KEY = "server-search-key";
  process.env.NEXT_PUBLIC_TOMTOM_API_KEY = "browser-map-key";
  vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 60 } });
  vi.spyOn(rateLimits, "rateLimit").mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.TOMTOM_API_KEY;
  delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
});

describe("POST /api/address/lookup", () => {
  it("uses the server key and returns a viewport candidate without placing a pin", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{
          position: { lat: 14.73508, lon: 121.0253 },
          viewport: {
            topLeftPoint: { lat: 14.74, lon: 121.02 },
            btmRightPoint: { lat: 14.73, lon: 121.03 },
          },
          address: { freeformAddress: "29 Ninang Virginia, Caloocan City" },
          type: "Point Address",
          matchConfidence: { score: 0.89 },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({ query: QUERY }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("found");
    expect(body.candidates[0]).toMatchObject({
      centre: { lat: 14.73508, lng: 121.0253 },
      precision: "Point Address",
      confidence: 0.89,
    });
    expect(body.candidates[0]).not.toHaveProperty("latitude");
    expect(fetch.mock.calls[0][0]).toContain("key=server-search-key");
    expect(fetch.mock.calls[0][0]).not.toContain("browser-map-key");
    expect(fetch.mock.calls[0][0]).toContain("countrySet=PH");
    expect(fetch.mock.calls[0][0]).toContain("limit=3");
    expect(apiUtils.requirePermission).toHaveBeenCalledWith(expect.anything(), "drivers", "update");
  });

  it("returns multiple valid candidates for an explicit operator choice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { position: { lat: 14.73508, lon: 121.0253 }, address: { freeformAddress: "29 Ninang Virginia" }, type: "Point Address" },
          { position: { lat: 14.7355, lon: 121.026 }, address: { freeformAddress: "29 Ninang Virginia Extension" }, type: "Street" },
        ],
      }),
    })));

    const response = await POST(request({ query: QUERY }));
    const body = await response.json();

    expect(body.status).toBe("ambiguous");
    expect(body.candidates).toHaveLength(2);
  });

  it("returns unavailable for a provider refusal without echoing the private query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));

    const response = await POST(request({ query: QUERY }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("Ninang Virginia");
  });

  it("returns unavailable when the provider request times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("provider timeout"); }));

    const response = await POST(request({ query: QUERY }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("rejects an overlong query before sending it to the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({ query: "x".repeat(1001) }));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
