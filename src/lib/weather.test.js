// Tests for the Open-Meteo current-weather adapter that feeds the mobile map
// screen's compact ambient weather chip.
//
// Contract:
// - parseCurrentWeather is pure: valid payload → {temperatureC, code, label};
//   missing/malformed fields → null; an unknown WMO code → null (silence,
//   never an invented label);
// - getCurrentWeather fails open to null on network/timeout/HTTP errors and
//   caches per coarse grid cell, so the provider never sees a per-ping call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCurrentWeather, getCurrentWeather } from "./weather";

const okResponse = (json) => ({ ok: true, json: async () => json });

const sample = { current: { temperature_2m: 28.4, weather_code: 61 } };

describe("parseCurrentWeather", () => {
  it("parses a valid current-weather payload", () => {
    expect(parseCurrentWeather(sample)).toEqual({
      temperatureC: 28.4,
      code: 61,
      label: "Light Rain",
    });
  });

  it("null for null/undefined/missing-current payloads", () => {
    expect(parseCurrentWeather(null)).toBeNull();
    expect(parseCurrentWeather(undefined)).toBeNull();
    expect(parseCurrentWeather({})).toBeNull();
    expect(parseCurrentWeather({ current: null })).toBeNull();
  });

  it("null when temperature or code is missing or non-numeric", () => {
    expect(parseCurrentWeather({ current: { weather_code: 61 } })).toBeNull();
    expect(parseCurrentWeather({ current: { temperature_2m: 28 } })).toBeNull();
    expect(parseCurrentWeather({ current: { temperature_2m: "warm", weather_code: 61 } })).toBeNull();
    expect(parseCurrentWeather({ current: { temperature_2m: 28, weather_code: "rainy" } })).toBeNull();
  });

  it("an unknown WMO code is silence, never an invented label", () => {
    expect(parseCurrentWeather({ current: { temperature_2m: 28, weather_code: 42 } })).toBeNull();
  });
});

describe("getCurrentWeather", () => {
  beforeEach(() => {
    vi.resetModules(); // drop the in-memory cache between tests
  });

  const load = async () => (await import("./weather")).getCurrentWeather;

  it("returns null for non-numeric coordinates without calling the provider", async () => {
    const fetchImpl = vi.fn();
    const get = await load();
    expect(await get("NaN", 121, { fetchImpl })).toBeNull();
    expect(await get(14.6, undefined, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails open to null when the provider errors or is not ok", async () => {
    const get = await load();
    expect(await get(14.6, 121, { fetchImpl: async () => { throw new Error("timeout"); } })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl: async () => okResponse({ current: {} }) })).toBeNull();
  });

  it("caches per coarse grid cell — one provider call for pings in the same cell", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => okResponse(sample));
    // Two pings ~200 m apart land in the same ~0.1° cell.
    expect(await get(14.601, 121.002, { fetchImpl })).toEqual({
      temperatureC: 28.4,
      code: 61,
      label: "Light Rain",
    });
    expect(await get(14.602, 121.003, { fetchImpl })).toEqual({
      temperatureC: 28.4,
      code: 61,
      label: "Light Rain",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a failed fetch is also cached (short-TTL) so an outage is not hammered per ping", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => { throw new Error("down"); });
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a distant coordinate misses the cache and calls the provider again", async () => {
    const get = await load();
    const fetchImpl = vi.fn(async () => okResponse(sample));
    await get(14.6, 121, { fetchImpl });
    await get(15.2, 122.1, { fetchImpl }); // different cell
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("same-cell coordinates round-trip through the shared cache — the no-trip endpoint and GPS ingest hit one provider call", async () => {
    // The /api/mobile/driver/weather endpoint (idle driver, last-known or
    // one-shot position) and the GPS POST enrichment share this module-level
    // cache, so both surfaces together still cost one call per cell per TTL.
    const get = await load();
    const fetchImpl = vi.fn(async () => okResponse(sample));
    await get(14.6, 121.004, { fetchImpl });
    await get(14.601, 121.0, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("getCurrentConditions composition", () => {
  const OLD_KEY = process.env.TOMTOM_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.TOMTOM_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.TOMTOM_API_KEY = OLD_KEY;
  });

  const load = async () => (await import("./weather")).getCurrentConditions;
  const address = (municipality) => ({
    addresses: [{ address: { municipality } }],
  });

  it("composes weather + placeName into one chip payload", async () => {
    const get = await load();
    const fetchImpl = async (url) =>
      String(url).includes("open-meteo")
        ? okResponse(sample)
        : okResponse(address("Quezon City"));
    expect(await get(14.6, 121, { fetchImpl })).toEqual({
      temperatureC: 28.4,
      code: 61,
      label: "Light Rain",
      placeName: "Quezon City",
    });
  });

  it("a place failure fails open — weather survives without a place", async () => {
    const get = await load();
    const fetchImpl = async (url) => {
      if (String(url).includes("open-meteo")) return okResponse(sample);
      throw new Error("geocoder down");
    };
    expect(await get(14.6, 121, { fetchImpl })).toEqual({
      temperatureC: 28.4,
      code: 61,
      label: "Light Rain",
      placeName: null,
    });
  });

  it("no weather → null regardless of place", async () => {
    const get = await load();
    const fetchImpl = async (url) =>
      String(url).includes("open-meteo")
        ? okResponse({ current: {} }) // unparseable weather
        : okResponse(address("Quezon City"));
    expect(await get(14.6, 121, { fetchImpl })).toBeNull();
  });
});
