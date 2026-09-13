// Tests for the mobile weather-chip derivation — the compact ambient pill on
// the Home header. Contract mirrors monitor-banner.test.js:
// - a null/invalid/unknown-code payload renders NOTHING (silence, never a
//   fabricated temperature or label);
// - label precedence: reverse-geocoded placeName ("Quezon City") over the
//   condition string — the icon carries the condition, the label says WHERE;
//   with neither, no chip;
// - every code the server can emit resolves to a Meteocons key.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { weatherChipFor, formatTemperature, WEATHER_ICON_KEYS } from "./weather-chip";

// Every WMO code src/lib/weather.js labels — the icon table must cover the
// same space, or the server would emit a payload the chip cannot render.
const SERVER_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 99,
];

const ASSET_DIR = fileURLToPath(new URL("../assets/images/weather/", import.meta.url));

describe("formatTemperature", () => {
  it("formats whole degrees with the degree sign", () => {
    expect(formatTemperature(28.4)).toBe("28°");
    expect(formatTemperature(27.6)).toBe("28°");
    expect(formatTemperature(28)).toBe("28°");
  });

  it("an invalid temperature is null, never '0°' or 'NaN°'", () => {
    expect(formatTemperature(null)).toBeNull();
    expect(formatTemperature(undefined)).toBeNull();
    expect(formatTemperature("warm")).toBeNull();
  });
});

describe("weatherChipFor", () => {
  it("renders the compact pill payload for a valid weather object", () => {
    expect(weatherChipFor({ temperatureC: 28.4, code: 61, label: "Light Rain" })).toEqual({
      icon: "rain",
      temperature: "28°",
      label: "Light Rain",
      isNight: false,
    });
  });

  it("the place label wins over the condition string — the icon carries the condition", () => {
    expect(
      weatherChipFor({ temperatureC: 28.4, code: 61, label: "Light Rain", placeName: "Quezon City" })
    ).toEqual({
      icon: "rain",
      temperature: "28°",
      label: "Quezon City",
      isNight: false,
    });
  });

  it("a whitespace-only placeName falls back to the condition string", () => {
    expect(weatherChipFor({ temperatureC: 28.4, code: 61, label: "Light Rain", placeName: "   " }))
      .toMatchObject({ label: "Light Rain" });
  });

  it("no place and no label renders nothing", () => {
    expect(weatherChipFor({ temperatureC: 28, code: 61, label: "", placeName: null })).toBeNull();
    expect(weatherChipFor({ temperatureC: 28, code: 61, label: null, placeName: "" })).toBeNull();
  });

  it("null/undefined/empty payloads render nothing", () => {
    expect(weatherChipFor(null)).toBeNull();
    expect(weatherChipFor(undefined)).toBeNull();
    expect(weatherChipFor({})).toBeNull();
  });

  it("a payload with a missing temperature or unknown code renders nothing", () => {
    expect(weatherChipFor({ code: 61, label: "Light Rain", placeName: "Quezon City" })).toBeNull();
    expect(weatherChipFor({ temperatureC: "warm", code: 61, label: "Light Rain" })).toBeNull();
    expect(weatherChipFor({ temperatureC: 28, code: 42, label: "???", placeName: "Somewhere" })).toBeNull();
  });

  it("every WMO code the server can label resolves to a known Meteocons key", () => {
    const known = new Set(WEATHER_ICON_KEYS);
    for (const code of SERVER_CODES) {
      const out = weatherChipFor({ temperatureC: 20, code, label: "Any", placeName: "Any" });
      expect(out, `code ${code} must map to an icon`).toBeTruthy();
      expect(known.has(out.icon), `code ${code} icon "${out.icon}" is not a known key`).toBe(true);
    }
  });

  it("every Meteocons key has its PNG assets on disk (@2x/@3x — @1x dropped, see ATTRIBUTION.md)", () => {
    expect(WEATHER_ICON_KEYS.length).toBeGreaterThan(0);
    for (const key of WEATHER_ICON_KEYS) {
      for (const suffix of ["@2x", "@3x"]) {
        expect(existsSync(`${ASSET_DIR}${key}${suffix}.png`), `missing asset ${key}${suffix}.png`).toBe(true);
      }
    }
  });

  it("drizzle reads as drizzle, rain as rain — families stay visually distinct", () => {
    for (const code of [51, 53, 55, 56, 57]) {
      expect(weatherChipFor({ temperatureC: 25, code, label: "Drizzle" }).icon).toBe("drizzle");
    }
    for (const code of [61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(weatherChipFor({ temperatureC: 25, code, label: "Rain" }).icon).toBe("rain");
    }
  });

  it("night clear skies use night art; other families keep their day key", () => {
    expect(weatherChipFor({ temperatureC: 27, code: 0, label: "Clear", isDay: false }).icon).toBe("clear-night");
    expect(weatherChipFor({ temperatureC: 27, code: 1, label: "Mostly Clear", isDay: false }).icon).toBe("mostly-clear-night");
    expect(weatherChipFor({ temperatureC: 27, code: 2, label: "Partly Cloudy", isDay: false }).icon).toBe("partly-cloudy-night");
    expect(weatherChipFor({ temperatureC: 27, code: 61, label: "Light Rain", isDay: false }).icon).toBe("rain");
    // Missing flag falls back to day — never silence.
    expect(weatherChipFor({ temperatureC: 27, code: 0, label: "Clear" }).icon).toBe("clear-day");
  });

  it("severe conditions keep the same compact payload shape — no banner state exists", () => {
    // The chip is the ONLY form weather takes; a thunderstorm changes the
    // icon/label, never the surface.
    expect(weatherChipFor({ temperatureC: 26, code: 95, label: "Thunderstorm", placeName: "Makati" })).toEqual({
      icon: "thunderstorms",
      temperature: "26°",
      label: "Makati",
      isNight: false,
    });
  });
});
