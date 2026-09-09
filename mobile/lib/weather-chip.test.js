// Tests for the mobile weather-chip derivation — the compact ambient pill on
// the Home header. Contract mirrors monitor-banner.test.js:
// - a null/invalid/unknown-code payload renders NOTHING (silence, never a
//   fabricated temperature or label);
// - label precedence: reverse-geocoded placeName ("Quezon City") over the
//   condition string — the icon carries the condition, the label says WHERE;
//   with neither, no chip;
// - every code the server can emit resolves to an Ionicons glyph name.
import { describe, it, expect } from "vitest";
import { weatherChipFor, formatTemperature } from "./weather-chip";

// Every WMO code src/lib/weather.js labels — the icon table must cover the
// same space, or the server would emit a payload the chip cannot render.
const SERVER_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 99,
];

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
      icon: "rainy",
      temperature: "28°",
      label: "Light Rain",
    });
  });

  it("the place label wins over the condition string — the icon carries the condition", () => {
    expect(
      weatherChipFor({ temperatureC: 28.4, code: 61, label: "Light Rain", placeName: "Quezon City" })
    ).toEqual({
      icon: "rainy",
      temperature: "28°",
      label: "Quezon City",
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

  it("every WMO code the server can label resolves to an Ionicon glyph name", () => {
    for (const code of SERVER_CODES) {
      const out = weatherChipFor({ temperatureC: 20, code, label: "Any", placeName: "Any" });
      expect(out, `code ${code} must map to an icon`).toBeTruthy();
      expect(typeof out.icon).toBe("string");
      expect(out.icon.length).toBeGreaterThan(0);
    }
  });

  it("severe conditions keep the same compact payload shape — no banner state exists", () => {
    // The chip is the ONLY form weather takes; a thunderstorm changes the
    // icon/label, never the surface.
    expect(weatherChipFor({ temperatureC: 26, code: 95, label: "Thunderstorm", placeName: "Makati" })).toEqual({
      icon: "thunderstorm",
      temperature: "26°",
      label: "Makati",
    });
  });
});
