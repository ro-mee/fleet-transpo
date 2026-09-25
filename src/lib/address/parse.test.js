// Tests for the TomTom -> AddressValue mapping.
//
// This is the file that pins the "never invent a component" rule. TomTom's field
// names are global vocabulary, and which one carried a Philippine barangay was an
// ASSUMPTION until 2026-09-25 — when four real payloads settled it: the field that
// would carry it (`municipalitySubdivision`) holds the district instead, so
// `barangay` is no longer mapped at all. Those four payloads are kept below as the
// regression net for that decision.
//
// These tests assert the behaviour that must hold whatever a provider sends:
//
//   - a field the provider did not send stays null;
//   - a field whose meaning was NOT measured stays null too, even when the
//     payload puts something tempting there;
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
//
// It is also, unnoticed at the time, an instance of the falsification below:
// `municipalitySubdivision` holds "Deparo", which is a district of Caloocan
// rather than a barangay.
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

// THE FOUR SURVEYED PAYLOADS — real TomTom reverse-geocode `address` objects for
// Philippine points, captured 2026-09-25. They are the evidence behind
// PH_COMPONENT_MAP and the reason `barangay` is not in it.
//
// Each keeps TomTom's own `freeformAddress` for the same point, verbatim, so the
// disagreement is visible in the fixture rather than only in a note: Caloocan's
// freeform names the district AND the barangay, while the structured
// `municipalitySubdivision` holds only the district.
const CALOOCAN_SURVEY = {
  freeformAddress: "Tamban Street, Maypajo, Barangay 28, Caloocan City, 1413, Metro Manila",
  streetName: "Tamban Street",
  municipalitySubdivision: "Maypajo",
  municipality: "Caloocan City",
  countrySecondarySubdivision: "Metro Manila",
  countrySubdivisionName: "National Capital Region",
  postalCode: "1413",
  country: "Philippines",
  countryCode: "PH",
};

const QUEZON_CITY_SURVEY = {
  freeformAddress: "38 Visayas Avenue, Balara, Pasong Tamo, Quezon City, 1107, Metro Manila",
  streetNumber: "38",
  streetName: "Visayas Avenue",
  municipalitySubdivision: "Balara",
  municipality: "Quezon City",
  countrySecondarySubdivision: "Metro Manila",
  countrySubdivisionName: "National Capital Region",
  postalCode: "1107",
  country: "Philippines",
  countryCode: "PH",
};

const CEBU_SURVEY = {
  freeformAddress: "1032 V. Rama Avenue, Guadalupe, Cebu City, 6000, Cebu",
  streetNumber: "1032",
  streetName: "V. Rama Avenue",
  municipalitySubdivision: "Guadalupe",
  municipality: "Cebu City",
  countrySecondarySubdivision: "Cebu",
  countrySubdivisionName: "Central Visayas",
  postalCode: "6000",
  country: "Philippines",
  countryCode: "PH",
};

const DAVAO_SURVEY = {
  freeformAddress: "Davao-Bukidnon Road, Calinan, Davao City, 8000, Davao del Sur",
  streetName: "Davao-Bukidnon Road",
  municipalitySubdivision: "Calinan",
  municipality: "Davao City",
  countrySecondarySubdivision: "Davao del Sur",
  countrySubdivisionName: "Davao Region",
  postalCode: "8000",
  country: "Philippines",
  countryCode: "PH",
};

describe("parseComponents", () => {
  it("maps the Philippine worked example onto the structured shape", () => {
    const components = parseComponents(CALOOCAN);
    expect(components.houseNumber).toBe("29");
    expect(components.street).toBe("Ninang Virginia");
    expect(components.city).toBe("Caloocan City");
    expect(components.region).toBe("National Capital Region");
    expect(components.country).toBe("Philippines");

    // Both changed on 2026-09-25, and both because the mapping was measured
    // rather than assumed:
    //
    //   barangay — `municipalitySubdivision` holds "Deparo", a Caloocan
    //     DISTRICT. The field is no longer mapped, so nothing fills this.
    //   province — "Metro Manila" is a region, and NCR has no provinces. The
    //     value is dropped rather than stored at the wrong level.
    expect(components.barangay).toBeNull();
    expect(components.province).toBeNull();
  });

  it("leaves components the provider never supplies as null", () => {
    // A geocoder cannot know which unit of a building someone lives in. These
    // three must stay null rather than being guessed from freeformAddress.
    const components = parseComponents(CALOOCAN);
    expect(components.unitNumber).toBeNull();
    expect(components.building).toBeNull();
    expect(components.subdivision).toBeNull();
  });

  it("does not put a region-level value into province, nor copy it back out", () => {
    // Measured: for NCR the provider reports "Metro Manila" at the
    // secondary-subdivision level. NCR has no provinces, so that is the region's
    // own name at the wrong level and it is dropped.
    //
    // The order of the two rules is what this pins. Nulling happens BEFORE the
    // fallback below can run, so the value cannot be copied straight from
    // `province` into `region` — which is where it came from. Both stay null:
    // the provider told us no province, so none is recorded.
    const components = parseComponents({
      municipality: "Caloocan City",
      countrySecondarySubdivision: "Metro Manila",
    });
    expect(components.province).toBeNull();
    expect(components.region).toBeNull();
  });

  it("recognises NCR from the region alone, when no province is reported", () => {
    // Both spellings are in the set, so a payload carrying only the region name
    // is still recognised — and must not come out with "National Capital Region"
    // sitting in `province`.
    const components = parseComponents({
      municipality: "Makati City",
      countrySubdivisionName: "National Capital Region",
    });
    expect(components.province).toBeNull();
    expect(components.region).toBe("National Capital Region");
  });

  it("falls back to the province when no region is reported", () => {
    // The fallback is still real, and still a copy of a supplied value rather
    // than an inference. It simply never fires for NCR any more. On a provincial
    // address with no region reported, the province fills both.
    const components = parseComponents({
      municipality: "Cebu City",
      countrySecondarySubdivision: "Cebu",
    });
    expect(components.province).toBe("Cebu");
    expect(components.region).toBe("Cebu");
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

// The regression net for the measured mapping. If anyone restores
// `barangay: "municipalitySubdivision"` to PH_COMPONENT_MAP, the first case
// below fails immediately — and the reason is in the fixture beside it.
describe("parseComponents — the four surveyed Philippine payloads", () => {
  const SURVEYED = [
    {
      name: "Caloocan, where the field holds the DISTRICT",
      payload: CALOOCAN_SURVEY,
      city: "Caloocan City",
      province: null,
      region: "National Capital Region",
      subdivision: "Maypajo",
    },
    {
      name: "Quezon City, where the field happens to hold a real barangay",
      payload: QUEZON_CITY_SURVEY,
      city: "Quezon City",
      province: null,
      region: "National Capital Region",
      subdivision: "Balara",
    },
    {
      name: "Cebu City, where the field also happens to hold a real barangay",
      payload: CEBU_SURVEY,
      city: "Cebu City",
      province: "Cebu",
      region: "Central Visayas",
      subdivision: "Guadalupe",
    },
    {
      name: "Davao City, where the field holds a district",
      payload: DAVAO_SURVEY,
      city: "Davao City",
      province: "Davao del Sur",
      region: "Davao Region",
      subdivision: "Calinan",
    },
  ];

  for (const point of SURVEYED) {
    it(point.name, () => {
      const components = parseComponents(point.payload);

      expect(components.city).toBe(point.city);
      expect(components.province).toBe(point.province);
      expect(components.region).toBe(point.region);

      // The load-bearing assertion, and it is the SAME one in all four cases —
      // including the two where the field happens to name a real barangay. Those
      // two are exactly why the field cannot be trusted: a rule that only holds
      // on the payloads that disagree is not a rule.
      expect(components.barangay).toBeNull();

      // The value being declined, asserted as PRESENT in the payload, so a
      // reader can see it was refused rather than simply missing.
      expect(point.payload.municipalitySubdivision).toBe(point.subdivision);
    });
  }

  it("Caloocan: the district and the barangay are both named, and the wrong one is structured", () => {
    // The proof. TomTom's own freeform for this point reads
    // "Tamban Street, Maypajo, Barangay 28, Caloocan City…" — it carries both
    // names, and the one it places in the structured subdivision field is the
    // district. No other structured field holds "Barangay 28".
    expect(CALOOCAN_SURVEY.municipalitySubdivision).toBe("Maypajo");
    expect(CALOOCAN_SURVEY.freeformAddress).toContain("Maypajo");
    expect(CALOOCAN_SURVEY.freeformAddress).toContain("Barangay 28");
    expect(parseComponents(CALOOCAN_SURVEY).barangay).toBeNull();
  });

  it("never recovers a barangay by reading the freeform", () => {
    // "Barangay 28" is sitting in the text, and lifting it out would be the
    // fuzzy inference this design refuses everywhere else. It also could not be
    // applied evenly: three of the four payloads never spell the barangay out at
    // all, so such a parser would fill exactly one address in four — and the
    // empty three would be indistinguishable from addresses with no barangay.
    expect(parseComponents(CALOOCAN_SURVEY).barangay).toBeNull();
    expect(
      parseComponents({ freeformAddress: "Barangay 28, Caloocan City, Metro Manila" }).barangay
    ).toBeNull();
  });

  it("applies the NCR province correction to both NCR payloads and neither provincial one", () => {
    // Metro Manila reports no province, so the value TomTom puts at that level
    // is the region's own name. Both NCR points must come out province-less.
    for (const payload of [CALOOCAN_SURVEY, QUEZON_CITY_SURVEY]) {
      const components = parseComponents(payload);
      expect(components.province).toBeNull();
      expect(components.region).toBe("National Capital Region");
    }
    // And the correction is NCR-specific: the provincial payloads keep theirs,
    // at the level they belong.
    expect(parseComponents(CEBU_SURVEY).province).toBe("Cebu");
    expect(parseComponents(CEBU_SURVEY).region).toBe("Central Visayas");
    expect(parseComponents(DAVAO_SURVEY).province).toBe("Davao del Sur");
    expect(parseComponents(DAVAO_SURVEY).region).toBe("Davao Region");
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
