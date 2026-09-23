// Tests for the TomTom address provider.
//
// Two things are load-bearing here beyond ordinary parsing:
//
//  1. The SERVER key authorises every call. If no server key is configured the
//     provider must make no network request at all — silently falling back to
//     the public key would put a key in the browser bundle's reach.
//  2. Search is keystroke-driven, so it caches aggressively. A cache that
//     forgot to store failures would hammer a provider that is already down.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSearchUrl,
  buildPlaceUrl,
  search,
  geocode,
  reverse,
  clearSearchCache,
  MIN_QUERY_LENGTH,
} from "./tomtom";

const OLD_KEY = process.env.TOMTOM_API_KEY;

const okResponse = (json) => ({ ok: true, json: async () => json });

const suggestionPayload = {
  results: [
    {
      id: "PH/POI/1",
      address: {
        freeformAddress: "29 Ninang Virginia, Deparo, Caloocan City, 1421",
        municipality: "Caloocan City",
        municipalitySubdivision: "Deparo",
        postalCode: "1421",
        country: "Philippines",
      },
      position: { lat: 14.7, lon: 121.0 },
    },
  ],
};

beforeEach(() => {
  clearSearchCache();
  process.env.TOMTOM_API_KEY = "test-server-key";
});

afterEach(() => {
  process.env.TOMTOM_API_KEY = OLD_KEY;
});

describe("buildSearchUrl", () => {
  it("scopes results to the Philippines and enables typeahead", () => {
    const url = new URL(buildSearchUrl("ninang virginia"));
    expect(url.origin + url.pathname).toContain("/search/2/search/");
    expect(url.searchParams.get("countrySet")).toBe("PH");
    expect(url.searchParams.get("typeahead")).toBe("true");
    expect(url.searchParams.get("key")).toBe("test-server-key");
  });

  it("uses the server key, never the public one", () => {
    process.env.NEXT_PUBLIC_TOMTOM_API_KEY = "public-key";
    const url = new URL(buildSearchUrl("test query"));
    expect(url.searchParams.get("key")).toBe("test-server-key");
    delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  });

  it("percent-encodes the query", () => {
    expect(buildSearchUrl("bf homes & deparo")).toContain(encodeURIComponent("bf homes & deparo"));
  });

  it("adds a proximity bias only when both coordinates are usable", () => {
    const biased = new URL(buildSearchUrl("deparo", { lat: 14.7, lon: 121 }));
    expect(biased.searchParams.get("lat")).toBe("14.7");
    expect(biased.searchParams.get("lon")).toBe("121");

    const halfBiased = new URL(buildSearchUrl("deparo", { lat: 14.7 }));
    expect(halfBiased.searchParams.has("lat")).toBe(false);
    expect(halfBiased.searchParams.has("lon")).toBe(false);
  });

  it("clamps the result limit into a sane range", () => {
    expect(new URL(buildSearchUrl("x", { limit: 500 })).searchParams.get("limit")).toBe("10");
    expect(new URL(buildSearchUrl("x", { limit: 0 })).searchParams.get("limit")).toBe("5");
  });
});

describe("buildPlaceUrl", () => {
  it("resolves a place by entity id", () => {
    const url = new URL(buildPlaceUrl("PH/POI/1"));
    expect(url.searchParams.get("entityId")).toBe("PH/POI/1");
    expect(url.searchParams.get("key")).toBe("test-server-key");
  });
});

describe("search", () => {
  it("makes no request when no server key is configured", async () => {
    process.env.TOMTOM_API_KEY = "";
    const fetchImpl = vi.fn();
    expect(await search("ninang virginia", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes no request for a query below the minimum length", async () => {
    const fetchImpl = vi.fn();
    expect(await search("ab", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(MIN_QUERY_LENGTH).toBeGreaterThan(2);
  });

  it("returns id + label and no coordinates", async () => {
    const fetchImpl = vi.fn(async () => okResponse(suggestionPayload));
    const suggestions = await search("ninang virginia", { fetchImpl });
    expect(suggestions[0].placeId).toBe("PH/POI/1");
    expect(suggestions[0].label).toContain("Caloocan City");
    expect(suggestions[0]).not.toHaveProperty("latitude");
  });

  it("caches identical queries, including case and spacing differences", async () => {
    const fetchImpl = vi.fn(async () => okResponse(suggestionPayload));
    await search("Ninang  Virginia", { fetchImpl });
    await search("ninang virginia", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches failures so an outage is not hammered per keystroke", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("down"); });
    expect(await search("ninang virginia", { fetchImpl })).toEqual([]);
    expect(await search("ninang virginia", { fetchImpl })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails open to [] on error / not-ok / unusable payloads", async () => {
    expect(await search("ninang virginia", { fetchImpl: async () => { throw new Error("timeout"); } })).toEqual([]);
    clearSearchCache();
    expect(await search("ninang virginia", { fetchImpl: async () => ({ ok: false }) })).toEqual([]);
    clearSearchCache();
    expect(await search("ninang virginia", { fetchImpl: async () => okResponse({}) })).toEqual([]);
  });
});

describe("geocode", () => {
  it("returns null without a place id or without a key", async () => {
    const fetchImpl = vi.fn();
    expect(await geocode("", { fetchImpl })).toBeNull();
    process.env.TOMTOM_API_KEY = "";
    expect(await geocode("PH/POI/1", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves a bare place.json payload into a verified value", async () => {
    const fetchImpl = vi.fn(async () => okResponse({
      id: "PH/POI/1",
      address: suggestionPayload.results[0].address,
      position: { lat: 14.7, lon: 121.0 },
    }));
    const value = await geocode("PH/POI/1", { fetchImpl, rawInput: "ninang virginia" });
    expect(value.verified).toBe(true);
    expect(value.latitude).toBeCloseTo(14.7);
    expect(value.postalCode).toBe("1421");
    expect(value.raw).toBe("ninang virginia");
  });

  it("also handles a results-wrapped payload", async () => {
    const fetchImpl = vi.fn(async () => okResponse(suggestionPayload));
    const value = await geocode("PH/POI/1", { fetchImpl });
    expect(value.formattedAddress).toContain("Caloocan City");
  });

  it("fails open to null", async () => {
    expect(await geocode("PH/POI/1", { fetchImpl: async () => { throw new Error("down"); } })).toBeNull();
    expect(await geocode("PH/POI/1", { fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await geocode("PH/POI/1", { fetchImpl: async () => okResponse({}) })).toBeNull();
  });
});

describe("reverse", () => {
  it("rejects unusable coordinates without a request", async () => {
    const fetchImpl = vi.fn();
    expect(await reverse(NaN, 121, { fetchImpl })).toBeNull();
    expect(await reverse(999, 121, { fetchImpl })).toBeNull();
    expect(await reverse(14.7, 999, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null without a key", async () => {
    process.env.TOMTOM_API_KEY = "";
    const fetchImpl = vi.fn();
    expect(await reverse(14.7, 121, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses the reverse-geocode envelope", async () => {
    const fetchImpl = vi.fn(async () => okResponse({
      addresses: [{ address: suggestionPayload.results[0].address, position: { lat: 14.7, lon: 121 } }],
    }));
    const value = await reverse(14.7, 121, { fetchImpl });
    expect(value.verified).toBe(true);
    expect(value.formattedAddress).toContain("Caloocan City");
  });

  it("fails open to null", async () => {
    expect(await reverse(14.7, 121, { fetchImpl: async () => { throw new Error("down"); } })).toBeNull();
    expect(await reverse(14.7, 121, { fetchImpl: async () => ({ ok: false }) })).toBeNull();
  });
});
