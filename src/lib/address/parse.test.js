// Tests for the TomTom -> AddressValue mapping.
//
// This is the file that pins the "never invent a component" rule. TomTom's
// field names are global vocabulary; which one carries a Philippine barangay
// is an assumption recorded in PH_COMPONENT_MAP. These tests do not assert that
// the assumption is CORRECT (only live data can settle that) — they assert the
// behaviour that must hold whichever way it resolves:
//
//   - a field the provider did not send stays null;
//   - a formatted address still renders when every component is null;
//   - verified is true only alongside a real coordinate pair.
import { describe, it, expect } from "vitest";
import {
  toAddressValue,
  parseComponents,
  parseSearchResponse,
  parseReverseResponse,
  emptyComponents,
  emptyAddressValue,
} from "./parse";

// The worked example from the feature request: 29 Ninang Virginia, BF Homes
// Deparo, Caloocan City, Metro Manila, 1421.
const CALOOCAN = {
  streetNumber: "29",
  streetName: "Ninang Virginia",
  municipalitySubdivision: "Deparo",
  municipality: "Caloocan City",
  countrySecondarySubdivision: "Metro Manila",
  countrySubdivisionName: "National Capital Region",
  postalCode: "1421",
  country: "Philippines",
  countryCode: "PH",
  freeformAddress: "29 Ninang Virginia, Deparo, Caloocan City, Metro Manila, 1421",
};

describe("parseComponents", () => {
  it("maps the Philippine worked example onto the structured shape", () => {
    const components = parseComponents(CALOOCAN);
    expect(components.houseNumber).toBe("29");
    expect(components.street).toBe("Ninang Virginia");
    expect(components.barangay).toBe("Deparo");
    expect(components.city).toBe("Caloocan City");
    expect(components.province).toBe("Metro Manila");
    expect(components.region).toBe("National Capital Region");
    expect(components.country).toBe("Philippines");
  });

  it("leaves components the provider never supplies as null", () => {
    // A geocoder cannot know which unit of a building someone lives in. These
    // three must stay null rather than being guessed from freeformAddress.
    const components = parseComponents(CALOOCAN);
    expect(components.unitNumber).toBeNull();
    expect(components.building).toBeNull();
    expect(components.subdivision).toBeNull();
  });

  it("falls back to the province when no region is reported", () => {
    const components = parseComponents({
      municipality: "Caloocan City",
      countrySecondarySubdivision: "Metro Manila",
    });
    expect(components.province).toBe("Metro Manila");
    expect(components.region).toBe("Metro Manila");
  });

  it("returns the full null shape for missing or junk input", () => {
    expect(parseComponents(null)).toEqual(emptyComponents());
    expect(parseComponents(undefined)).toEqual(emptyComponents());
    expect(parseComponents("nope")).toEqual(emptyComponents());
  });

  it("treats blank strings as absent rather than empty text", () => {
    const components = parseComponents({ municipality: "   ", streetName: "" });
    expect(components.city).toBeNull();
    expect(components.street).toBeNull();
  });
});

describe("toAddressValue", () => {
  it("produces a verified value with a real coordinate pair", () => {
    const value = toAddressValue({
      address: CALOOCAN,
      position: { lat: 14.7, lon: 121.0 },
      id: "PH/POI/123",
      rawInput: "29 Ninang Virginia",
    });
    expect(value.verified).toBe(true);
    expect(value.latitude).toBeCloseTo(14.7);
    expect(value.longitude).toBeCloseTo(121.0);
    expect(value.formattedAddress).toContain("Caloocan City");
    expect(value.postalCode).toBe("1421");
    expect(value.postalCodeSource).toBe("provider");
    expect(value.provider).toBe("tomtom");
    expect(value.providerPlaceId).toBe("PH/POI/123");
    expect(value.verifiedAt).toEqual(expect.any(String));
  });

  it("is not verified without a usable coordinate pair", () => {
    const noPosition = toAddressValue({ address: CALOOCAN, id: "1" });
    expect(noPosition.verified).toBe(false);
    expect(noPosition.latitude).toBeNull();
    expect(noPosition.longitude).toBeNull();

    // Half a pair is refused outright rather than stored as a partial location.
    const halfPair = toAddressValue({ address: CALOOCAN, position: { lat: 14.7 }, id: "1" });
    expect(halfPair.latitude).toBeNull();
    expect(halfPair.longitude).toBeNull();
    expect(halfPair.verified).toBe(false);
  });

  it("rejects out-of-range coordinates instead of storing them", () => {
    const value = toAddressValue({ address: CALOOCAN, position: { lat: 999, lon: 121 }, id: "1" });
    expect(value.latitude).toBeNull();
    expect(value.verified).toBe(false);
  });

  it("never invents a postal code", () => {
    const { postalCode, ...withoutPostal } = CALOOCAN;
    const value = toAddressValue({ address: withoutPostal, position: { lat: 14.7, lon: 121 }, id: "1" });
    expect(value.postalCode).toBeNull();
    expect(value.postalCodeSource).toBeNull();
    // An address with no ZIP is still a verified LOCATION — the two are
    // independent, which is the pairing the UI has to be able to show.
    expect(value.verified).toBe(true);
  });

  it("refuses a result with no formatted address", () => {
    expect(toAddressValue({ address: { municipality: "Caloocan City" }, id: "1" })).toBeNull();
    expect(toAddressValue({})).toBeNull();
    expect(toAddressValue()).toBeNull();
  });
});

describe("parseSearchResponse", () => {
  it("returns id + label + locality and NO coordinates", () => {
    const suggestions = parseSearchResponse({
      results: [
        { id: "PH/POI/1", address: CALOOCAN, position: { lat: 14.7, lon: 121.0 } },
        { id: "PH/POI/2", address: { freeformAddress: "Deparo, Caloocan City", municipality: "Caloocan City" } },
      ],
    });
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toEqual({
      placeId: "PH/POI/1",
      label: "29 Ninang Virginia, Deparo, Caloocan City, Metro Manila, 1421",
      secondary: "Deparo",
    });
    // The confidentiality rule: the browser is never handed coordinates it
    // could submit as its own.
    expect(suggestions[0]).not.toHaveProperty("latitude");
    expect(suggestions[0]).not.toHaveProperty("longitude");
  });

  it("drops entries with no id or no label", () => {
    const suggestions = parseSearchResponse({
      results: [
        { address: { freeformAddress: "No id here" } },
        { id: "PH/1", address: {} },
        { id: "PH/2", address: { freeformAddress: "Keep me" } },
      ],
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].placeId).toBe("PH/2");
  });

  it("is empty for junk payloads", () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ results: "nope" })).toEqual([]);
  });
});

describe("parseReverseResponse", () => {
  it("reads the addresses envelope", () => {
    const value = parseReverseResponse({
      addresses: [{ address: CALOOCAN, position: { lat: 14.7, lon: 121.0 } }],
    });
    expect(value.formattedAddress).toContain("Caloocan City");
    expect(value.verified).toBe(true);
  });

  it("is null for an empty or missing envelope", () => {
    expect(parseReverseResponse(null)).toBeNull();
    expect(parseReverseResponse({ addresses: [] })).toBeNull();
    expect(parseReverseResponse({ addresses: [{}] })).toBeNull();
  });
});

describe("emptyAddressValue", () => {
  it("is an unverified blank that still carries the full shape", () => {
    const value = emptyAddressValue("typed text");
    expect(value.verified).toBe(false);
    expect(value.latitude).toBeNull();
    expect(value.components).toEqual(emptyComponents());
    expect(value.raw).toBe("typed text");
  });
});
