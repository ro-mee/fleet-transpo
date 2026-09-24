// Tests for the cascading address form's pure core.
//
// Three contracts are asserted here, each because getting it wrong produces a
// plausible-looking address that is silently wrong:
//
//   1. Changing a level DISCARDS everything below it AND the pin. Requirement:
//      "Address B must never be submitted with Latitude A."
//   2. A region with no provinces still produces a complete address. Metro Manila
//      has none; a cascade that assumes four levels everywhere makes every NCR
//      address unsaveable.
//   3. The composed address matches the required display format, including the
//      "4026, Philippines" final line and the omission of empty optional lines.
import { describe, it, expect } from "vitest";
import {
  ADDRESS_TYPES,
  ADDRESS_TYPE_VALUES,
  CASCADE_LEVELS,
  EMPTY_STRUCTURED_ADDRESS,
  clearBelow,
  clearDerivedFromDetails,
  detailErrors,
  isOperational,
  requiredDetailFields,
  selectLevel,
  editDetail,
  missingLevels,
  structuredErrors,
  isStructuredComplete,
  composeStructuredLines,
  formatStructuredAddress,
  regionRequiresProvince,
} from "./structured";

/** A fully filled Cebu address, used as the "before" state in the staleness tests. */
function filledAddress() {
  return {
    ...EMPTY_STRUCTURED_ADDRESS,
    type: "home",
    regionCode: "0700000000",
    regionName: "Central Visayas (Region VII)",
    provinceCode: "0722000000",
    provinceName: "Cebu",
    cityCode: "0722170000",
    cityName: "Cebu City",
    barangayCode: "0722170010",
    barangayName: "Lahug",
    houseBuildingNumber: "12",
    streetRoad: "Salinas Drive",
    postalCode: "6000",
    latitude: 10.3173,
    longitude: 123.8907,
  };
}

describe("clearBelow", () => {
  it("discards every level under the one that changed, plus the pin", () => {
    const cleared = clearBelow("region");

    expect(cleared).toContain("provinceCode");
    expect(cleared).toContain("provinceName");
    expect(cleared).toContain("cityCode");
    expect(cleared).toContain("barangayName");
    expect(cleared).toContain("latitude");
    expect(cleared).toContain("longitude");
  });

  it("never clears the level that changed, nor anything above it", () => {
    const cleared = clearBelow("city");

    // The caller replaces `city` itself with the new selection; clearing it here
    // would wipe the value it just set.
    expect(cleared).not.toContain("cityCode");
    expect(cleared).not.toContain("regionCode");
    expect(cleared).not.toContain("provinceCode");
    expect(cleared).toContain("barangayCode");
  });

  it("clears nothing for the innermost level except the pin", () => {
    expect(clearBelow("barangay").sort()).toEqual(["latitude", "longitude"]);
  });

  it("clears nothing at all for an unknown level", () => {
    // Silently wiping the whole form on a typo'd argument would be worse than
    // doing nothing.
    expect(clearBelow("country")).toEqual([]);
  });
});

describe("selectLevel — the anti-stale rule", () => {
  it("changing the city drops the barangay and the pin", () => {
    // The exact hazard: pick a barangay, place the pin, go back and change the
    // city. Without this the row is structurally valid and points at the wrong
    // place — the failure mode with no visible symptom.
    const next = selectLevel(filledAddress(), "city", {
      cityCode: "0722179999",
      cityName: "Mandaue City",
    });

    expect(next.cityName).toBe("Mandaue City");
    expect(next.barangayCode).toBeNull();
    expect(next.barangayName).toBeNull();
    expect(next.latitude).toBeNull();
    expect(next.longitude).toBeNull();
  });

  it("keeps the levels above the change", () => {
    const next = selectLevel(filledAddress(), "city", { cityCode: "X", cityName: "Mandaue City" });

    expect(next.regionName).toBe("Central Visayas (Region VII)");
    expect(next.provinceName).toBe("Cebu");
  });

  it("changing the region clears the entire chain beneath it", () => {
    const next = selectLevel(filledAddress(), "region", {
      regionCode: "0400000000",
      regionName: "CALABARZON (Region IV-A)",
    });

    expect(next.provinceCode).toBeNull();
    expect(next.cityCode).toBeNull();
    expect(next.barangayCode).toBeNull();
    expect(next.latitude).toBeNull();
  });

  it("does not touch the typed address details", () => {
    // Re-selecting the barangay is not a reason to lose a typed street name.
    const next = selectLevel(filledAddress(), "barangay", {
      barangayCode: "0722170011",
      barangayName: "Apas",
    });

    expect(next.streetRoad).toBe("Salinas Drive");
    expect(next.houseBuildingNumber).toBe("12");
    expect(next.postalCode).toBe("6000");
  });

  it("keeps a selection that also appears in the cleared set", () => {
    // `clearBelow("city")` includes `cityHasNoProvince`, so it is a key that the
    // reset and the selection BOTH name. If the reset is applied after the
    // selection the flag always comes out false, and every Metro Manila address
    // then demands a province that does not exist.
    const next = selectLevel(filledAddress(), "city", {
      cityCode: "1339000000",
      cityName: "City of Manila",
      cityHasNoProvince: true,
    });

    expect(next.cityHasNoProvince).toBe(true);
    expect(isStructuredComplete({ ...next, barangayCode: "B" }, { requiresProvince: false })).toBe(
      true
    );
  });

  it("clears the province-less flag when a city WITH a province is chosen", () => {
    // The same key must still be cleared on the opposite transition, or an NCR
    // address that is re-pointed at Cebu keeps skipping its province line.
    const ncr = { ...filledAddress(), cityHasNoProvince: true };
    const next = selectLevel(ncr, "city", { cityCode: "0722170000", cityName: "Cebu City" });

    expect(next.cityHasNoProvince).toBe(false);
  });
});

describe("editDetail", () => {
  it("discards the pin when any address detail changes", () => {
    // Stricter than it looks, and deliberately so: a pin placed for "8572" is not
    // the pin for "8573". See the module header.
    const next = editDetail(filledAddress(), "houseBuildingNumber", "13");

    expect(next.houseBuildingNumber).toBe("13");
    expect(next.latitude).toBeNull();
    expect(next.longitude).toBeNull();
  });

  it("keeps the geographic selection intact", () => {
    const next = editDetail(filledAddress(), "streetRoad", "Osmeña Boulevard");

    expect(next.barangayName).toBe("Lahug");
    expect(next.cityName).toBe("Cebu City");
  });

  it("clears only the pin, nothing else", () => {
    expect(clearDerivedFromDetails().sort()).toEqual(["latitude", "longitude"]);
  });
});

describe("missingLevels — the province-less region", () => {
  const ncr = {
    ...EMPTY_STRUCTURED_ADDRESS,
    regionCode: "1300000000",
    regionName: "National Capital Region (NCR)",
    cityCode: "1339000000",
    cityName: "City of Manila",
    barangayCode: "1339000001",
    barangayName: "Ermita",
    cityHasNoProvince: true,
    houseBuildingNumber: "1",
    streetRoad: "Roxas Boulevard",
    postalCode: "1000",
  };

  it("requires a province when the region has provinces", () => {
    expect(missingLevels(EMPTY_STRUCTURED_ADDRESS, { requiresProvince: true })).toContain(
      "province"
    );
  });

  it("does NOT require a province when the region has none", () => {
    // The Metro Manila case. Requiring it here would leave every NCR address
    // permanently unsaveable.
    expect(missingLevels(ncr, { requiresProvince: false })).toEqual([]);
  });

  it("treats a complete NCR address as complete", () => {
    expect(isStructuredComplete(ncr, { requiresProvince: false })).toBe(true);
  });

  it("still treats the same address as incomplete when a province IS required", () => {
    // Guards the parameter being ignored — the same object must fail under the
    // stricter rule.
    expect(isStructuredComplete(ncr, { requiresProvince: true })).toBe(false);
  });
});

describe("structuredErrors", () => {
  it("names every empty required field", () => {
    const errors = structuredErrors(EMPTY_STRUCTURED_ADDRESS, { requiresProvince: true });

    expect(Object.keys(errors).sort()).toEqual(
      ["barangay", "city", "houseBuildingNumber", "postalCode", "province", "region", "streetRoad"]
    );
  });

  it("does not require the optional delivery fields", () => {
    const complete = {
      ...EMPTY_STRUCTURED_ADDRESS,
      regionCode: "R",
      cityCode: "C",
      barangayCode: "B",
      houseBuildingNumber: "8572",
      streetRoad: "Winding Creek Boulevard",
      postalCode: "4026",
    };

    const errors = structuredErrors(complete, { requiresProvince: false });
    expect(errors.unitFloorBuilding).toBeUndefined();
    expect(errors.subdivisionVillage).toBeUndefined();
    expect(errors.landmark).toBeUndefined();
    expect(errors.additionalDetails).toBeUndefined();
    expect(errors).toEqual({});
  });

  it("rejects a malformed ZIP but never requires one to match the city", () => {
    const base = {
      ...EMPTY_STRUCTURED_ADDRESS,
      regionCode: "R",
      cityCode: "C",
      barangayCode: "B",
      houseBuildingNumber: "1",
      streetRoad: "Street",
    };

    expect(structuredErrors({ ...base, postalCode: "402" }, { requiresProvince: false }).postalCode)
      .toMatch(/4 digits/);
    expect(structuredErrors({ ...base, postalCode: "ABCD" }, { requiresProvince: false }).postalCode)
      .toMatch(/4 digits/);
    // Format only — whether 4026 belongs to Santa Rosa is not knowable here and
    // is not claimed.
    expect(structuredErrors({ ...base, postalCode: "4026" }, { requiresProvince: false }).postalCode)
      .toBeUndefined();
  });

  it("treats a whitespace-only required field as empty", () => {
    const errors = structuredErrors(
      { ...EMPTY_STRUCTURED_ADDRESS, houseBuildingNumber: "   " },
      { requiresProvince: false }
    );
    expect(errors.houseBuildingNumber).toBeTruthy();
  });
});

describe("ADDRESS_TYPES", () => {
  it("offers an operational type, and derives the accepted values from it", () => {
    const values = ADDRESS_TYPES.map((type) => type.value);
    expect(values).toContain("operational");
    // `ADDRESS_TYPE_VALUES` is what the server validates against; deriving it is
    // what stops the two lists disagreeing about whether a type is storable.
    expect(ADDRESS_TYPE_VALUES).toEqual(values);
  });

  it("keeps every type labelled and described, including the new one", () => {
    // A type with no label renders as an empty button in the radiogroup.
    for (const type of ADDRESS_TYPES) {
      expect(type.label).toBeTruthy();
      expect(type.description).toBeTruthy();
    }
  });
});

describe("the operational exception", () => {
  /** A picked address with every required field filled. */
  const complete = {
    ...EMPTY_STRUCTURED_ADDRESS,
    regionCode: "R",
    cityCode: "C",
    barangayCode: "B",
    houseBuildingNumber: "8572",
    streetRoad: "Winding Creek Boulevard",
    postalCode: "4026",
  };

  it("does not require a house number on an operational address", () => {
    // The case this exists for: NAIA Terminal 3 - Arrivals (Bay 9) has a road and
    // a ZIP and no number. Before this, the only ways to save it were to invent a
    // number or not save it.
    const errors = structuredErrors(
      { ...complete, type: "operational", houseBuildingNumber: "" },
      { requiresProvince: false }
    );
    expect(errors).toEqual({});
  });

  it("still requires the street and the ZIP on an operational address", () => {
    // The relaxation is one field, not "operational addresses validate less".
    const noStreet = structuredErrors(
      { ...complete, type: "operational", streetRoad: "" },
      { requiresProvince: false }
    );
    const noZip = structuredErrors(
      { ...complete, type: "operational", postalCode: "" },
      { requiresProvince: false }
    );
    expect(noStreet.streetRoad).toBeTruthy();
    expect(noZip.postalCode).toBeTruthy();
  });

  it("still rejects a malformed ZIP on an operational address", () => {
    // Format is not part of the exception — a three-digit ZIP is wrong wherever
    // it appears.
    const errors = structuredErrors(
      { ...complete, type: "operational", houseBuildingNumber: "", postalCode: "402" },
      { requiresProvince: false }
    );
    expect(errors.postalCode).toMatch(/4 digits/);
  });

  it("does NOT relax the house number for any other type", () => {
    // The whole safety of the exception: it is scoped to one value. If any of
    // these passed, the relaxation would have leaked into every personal address.
    for (const type of ["home", "office", "other"]) {
      const errors = structuredErrors(
        { ...complete, type, houseBuildingNumber: "" },
        { requiresProvince: false }
      );
      expect(errors.houseBuildingNumber).toBeTruthy();
    }
  });

  it("does NOT relax it for a missing or unknown type either", () => {
    // Absent `type` must take the STRICT branch. The failure that guards against
    // is a caller that forgets the field being handed the loose rule by default.
    for (const type of [undefined, null, "", "palace"]) {
      expect(isOperational({ ...complete, type })).toBe(false);
      expect(
        structuredErrors({ ...complete, type, houseBuildingNumber: "" }, { requiresProvince: false })
          .houseBuildingNumber
      ).toBeTruthy();
    }
  });

  it("reads the same rule the form reads", () => {
    // `requiredDetailFields` is exported for the component's required marks; a
    // field flagged required while the validator saves it empty (or the reverse)
    // is the drift this function exists to prevent.
    expect(requiredDetailFields({ type: "operational" })).toEqual(["streetRoad", "postalCode"]);
    expect(requiredDetailFields({ type: "home" })).toEqual([
      "houseBuildingNumber",
      "streetRoad",
      "postalCode",
    ]);
    // Same answer as `detailErrors`, asked the other way round.
    const operational = { ...complete, type: "operational", houseBuildingNumber: "" };
    expect(detailErrors(operational)).toEqual({});
  });

  it("is safe to ask about nothing at all", () => {
    expect(isOperational(undefined)).toBe(false);
    expect(isOperational({})).toBe(false);
  });
});

describe("composeStructuredLines", () => {
  it("produces the required display format exactly", () => {
    const lines = composeStructuredLines({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "8572",
      streetRoad: "Winding Creek Boulevard",
      subdivisionVillage: "Example Village",
      barangayName: "Balibago",
      cityName: "Santa Rosa City",
      provinceName: "Laguna",
      regionName: "CALABARZON (Region IV-A)",
      postalCode: "4026",
    });

    expect(lines).toEqual([
      "8572 Winding Creek Boulevard",
      "Example Village",
      "Barangay Balibago",
      "Santa Rosa City",
      "Laguna",
      "CALABARZON (Region IV-A)",
      "4026, Philippines",
    ]);
  });

  it("joins to a single comma-separated string", () => {
    const formatted = formatStructuredAddress({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "8572",
      streetRoad: "Winding Creek Boulevard",
      subdivisionVillage: "Example Village",
      barangayName: "Balibago",
      cityName: "Santa Rosa City",
      provinceName: "Laguna",
      regionName: "CALABARZON (Region IV-A)",
      postalCode: "4026",
    });

    expect(formatted).toBe(
      "8572 Winding Creek Boulevard, Example Village, Barangay Balibago, " +
        "Santa Rosa City, Laguna, CALABARZON (Region IV-A), 4026, Philippines"
    );
  });

  it("omits empty optional lines instead of leaving gaps", () => {
    const formatted = formatStructuredAddress({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "1",
      streetRoad: "Roxas Boulevard",
      barangayName: "Ermita",
      cityName: "City of Manila",
      regionName: "National Capital Region (NCR)",
      postalCode: "1000",
    });

    expect(formatted).not.toMatch(/,\s*,/);
    expect(formatted).toBe(
      "1 Roxas Boulevard, Barangay Ermita, City of Manila, " +
        "National Capital Region (NCR), 1000, Philippines"
    );
  });

  it("skips the province line entirely for a province-less city", () => {
    const lines = composeStructuredLines({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "1",
      streetRoad: "Roxas Boulevard",
      barangayName: "Ermita",
      cityName: "City of Manila",
      cityHasNoProvince: true,
      regionName: "National Capital Region (NCR)",
      postalCode: "1000",
    });

    expect(lines).not.toContain("");
    expect(lines.join(" ")).not.toMatch(/undefined|null/);
  });

  it("never invents a ZIP — a missing code yields the country alone", () => {
    const lines = composeStructuredLines({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "1",
      streetRoad: "Street",
      barangayName: "Barangay",
      cityName: "City",
      regionName: "Region",
      postalCode: "",
    });

    expect(lines[lines.length - 1]).toBe("Philippines");
  });

  it("keeps landmark and delivery notes OUT of the stored address", () => {
    // They are instructions to the driver, not postal lines. Including them would
    // make every consumer of formatted_address treat a note as part of the address.
    const formatted = formatStructuredAddress({
      ...EMPTY_STRUCTURED_ADDRESS,
      houseBuildingNumber: "1",
      streetRoad: "Street",
      barangayName: "Barangay",
      cityName: "City",
      regionName: "Region",
      postalCode: "1000",
      landmark: "Near the main gate",
      additionalDetails: "2nd floor, blue gate",
    });

    expect(formatted).not.toContain("main gate");
    expect(formatted).not.toContain("blue gate");
  });
});

// The prefix is added for readability — a bare barangay name reads like a street
// or a subdivision — but some barangays are NAMED with it already, so an
// unconditional prefix renders them "Barangay Barangay NNN". Every barangay of
// Manila and Pasay is named that way, which is why this is a real set of
// addresses rather than a curiosity. The rule under test is generic: it does not
// name Pasay, Barangay 197 or Barangay 183 anywhere in the implementation.
describe("the barangay prefix — added once, never twice", () => {
  const formattedFor = (barangayName) =>
    formatStructuredAddress({
      ...EMPTY_STRUCTURED_ADDRESS,
      streetRoad: "Street",
      barangayName,
      cityName: "City",
      regionName: "Region",
      postalCode: "1000",
    });

  it("prefixes a name that has no prefix of its own — Tambo", () => {
    expect(formattedFor("Tambo")).toContain("Barangay Tambo");
  });

  it("still prefixes an unprefixed name exactly as it always did — Ermita", () => {
    expect(formattedFor("Ermita")).toContain("Barangay Ermita");
  });

  it("leaves 'Barangay 197' alone, because that IS its name", () => {
    expect(formattedFor("Barangay 197")).toContain("Barangay 197");
    expect(formattedFor("Barangay 197")).not.toContain("Barangay Barangay");
  });

  it("leaves 'Barangay 183' alone too — the rule is generic, not about one city", () => {
    expect(formattedFor("Barangay 183")).toContain("Barangay 183");
    expect(formattedFor("Barangay 183")).not.toContain("Barangay Barangay");
  });

  it("matches an existing prefix case-insensitively, without rewriting the spelling", () => {
    const formatted = formattedFor("barangay 197");
    expect(formatted).toContain("barangay 197");
    expect(formatted).not.toMatch(/barangay barangay/i);
  });

  it("does not rewrite an existing prefix's case to the canonical one", () => {
    expect(formattedFor("BARANGAY 12")).toContain("BARANGAY 12");
    expect(formattedFor("BARANGAY 12")).not.toMatch(/Barangay BARANGAY/i);
  });

  it("trims the supplied name before deciding", () => {
    expect(formattedFor("  Tambo  ")).toContain("Barangay Tambo");
    expect(formattedFor("  Barangay 197  ")).toContain("Barangay 197");
    expect(formattedFor("  Barangay 197  ")).not.toContain("Barangay Barangay");
  });

  it("requires 'Barangay' to stand alone as a word, not merely to start the string", () => {
    // "Barangay197" is one word and is not the prefix, so it takes one.
    expect(formattedFor("Barangay197")).toContain("Barangay Barangay197");
  });

  it("does not mistake the word appearing later for an existing prefix", () => {
    expect(formattedFor("Santo Niño, Barangay 5")).toContain("Barangay Santo Niño, Barangay 5");
  });

  it("renders the whole address correctly for a numbered barangay", () => {
    // The shape the canonical-location migration depends on.
    expect(formattedFor("Barangay 197")).toBe(
      "Street, Barangay 197, City, Region, 1000, Philippines"
    );
  });

  it("does not mutate the value it was handed — this is presentation only", () => {
    const value = { ...EMPTY_STRUCTURED_ADDRESS, streetRoad: "Street", barangayName: "Barangay 197" };
    composeStructuredLines(value);
    expect(value.barangayName).toBe("Barangay 197");
  });
});

describe("regionRequiresProvince", () => {
  it("assumes a province is required until the list arrives", () => {
    // Guessing "no province" while loading would let an incomplete address render
    // as complete for the duration of the request.
    expect(regionRequiresProvince(undefined, false)).toBe(true);
    expect(regionRequiresProvince([], false)).toBe(true);
  });

  it("is false only once a loaded list is known to be empty", () => {
    expect(regionRequiresProvince([], true)).toBe(false);
    expect(regionRequiresProvince([{ code: "0722000000", name: "Cebu" }], true)).toBe(true);
  });
});

describe("CASCADE_LEVELS", () => {
  it("is ordered outermost first, because clearBelow depends on it", () => {
    expect(CASCADE_LEVELS).toEqual(["region", "province", "city", "barangay"]);
  });
});
