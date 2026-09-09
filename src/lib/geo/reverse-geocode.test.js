// Tests for the reverse-geocoding adapter that gives the weather chip its
// place label ("Quezon City" instead of a condition string).
//
// Contract:
// - parsePlaceName is pure: municipality > locality >
//   countrySecondarySubdivision > countrySubdivisionName; missing/blank → null;
// - getPlaceName fails open to null (no key, error, not-ok) and caches per
//   coarse grid cell;
// - getCurrentConditions composes weather + place, with place failing open
//   without losing the weather.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePlaceName } from "./reverse-geocode";

const okResponse = (json) => ({ ok: true, json: async () => json });

const sampleAddress = (fields) => ({
  addresses: [{ address: fields }],
});

describe("parsePlaceName", () => {
  it("prefers municipality, then locality, then subdivisions", () => {
    expect(parsePlaceName(sampleAddress({
      municipality: "Quezon City", locality: "Diliman", countrySecondarySubdivision: "Metro Manila",
    }))).toBe("Quezon City");
    expect(parsePlaceName(sampleAddress({ locality: "Diliman" }))).toBe("Diliman");
    expect(parsePlaceName(sampleAddress({ countrySecondarySubdivision: "Rizal" }))).toBe("Rizal");
    expect(parsePlaceName(sampleAddress({ countrySubdivisionName: "Cebu" }))).toBe("Cebu");
  });

  it("null for null/missing/blank payloads", () => {
    expect(parsePlaceName(null)).toBeNull();
    expect(parsePlaceName({})).toBeNull();
    expect(parsePlaceName({ addresses: [] })).toBeNull();
    expect(parsePlaceName(sampleAddress({ municipality: "   " }))).toBeNull();
    expect(parsePlaceName(sampleAddress({ street: "Katipunan Ave" }))).toBeNull();
  });
});

describe("getPlaceName", () => {
  const OLD_KEY = process.env.TOMTOM_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.TOMTOM_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.TOMTOM_API_KEY = OLD_KEY;
  });

  const load = async () => (await import("./reverse-geocode")).getPlaceName;

  it("null without calling the provider when no server key is configured", async () => {
    process.env.TOMTOM_API_KEY = "";
    const fetchImpl = vi.fn();
    const get = await load();
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses the municipality from a reverse-geocode response", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => okResponse(sampleAddress({ municipality: "Quezon City" })));
    expect(await get(14.6, 121, { fetchImpl })).toBe("Quezon City");
  });

  it("fails open to null on error / not-ok / unusable payloads", async () => {
    const get = await load();
    expect(await get(14.6, 121, { fetchImpl: async () => { throw new Error("timeout"); } })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl: async () => okResponse({ addresses: [] }) })).toBeNull();
  });

  it("caches per coarse grid cell — one provider call for same-cell lookups", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => okResponse(sampleAddress({ municipality: "Quezon City" })));
    await get(14.601, 121.002, { fetchImpl });
    await get(14.602, 121.003, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a failed lookup is also cached so an outage is not hammered", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => { throw new Error("down"); });
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});


