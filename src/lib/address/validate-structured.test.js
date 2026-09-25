// Tests for the server-side validation of a PICKED address.
//
// This is the boundary that decides what gets written, so the tests are about
// what the server REFUSES and what it OVERRIDES — not about the happy path.
//
// The one rule under test throughout: the client's region/province/city text is
// discarded. A request that claims Cebu City while naming a Santa Rosa barangay
// must store Santa Rosa, and the test asserts the STORED value, because a
// validation that merely "notices" the mismatch and proceeds is not a fix.
import { describe, it, expect, vi } from "vitest";
import {
  normalizeStructuredInput,
  resolveStructuredAddress,
} from "./validate-structured";
// Imported so this file can drive the FORM's constructors into the server's
// input — see "the form's value and the server's input agree" at the bottom.
import {
  CASCADE_LEVEL_KEYS,
  EMPTY_STRUCTURED_ADDRESS,
  editDetail,
  selectLevel,
} from "./structured";

/** A resolved chain, shaped exactly like `resolveBarangayChain`'s return. */
const SANTA_ROSA = {
  region: { code: "0400000000", name: "CALABARZON (Region IV-A)" },
  province: { code: "0434000000", name: "Laguna" },
  city: { code: "0434040000", name: "Santa Rosa City" },
  barangay: { code: "043404001", name: "Balibago" },
};

/** A province-less chain — the Metro Manila shape, where province is null. */
const MANILA = {
  region: { code: "1300000000", name: "National Capital Region (NCR)" },
  province: null,
  city: { code: "1339000000", name: "City of Manila" },
  barangay: { code: "1339000001", name: "Ermita" },
};

/** The minimum a savable address needs, plus its barangay choice. */
function request(overrides = {}) {
  return {
    type: "home",
    psgcBarangayCode: "043404001",
    houseBuildingNumber: "8572",
    streetRoad: "Winding Creek Boulevard",
    postalCode: "4026",
    ...overrides,
  };
}

const resolveAs = (chain) => vi.fn(async () => chain);

describe("normalizeStructuredInput", () => {
  it("drops client-supplied geography entirely", () => {
    // These keys are not read at all. Asserting their absence from the output is
    // what stops a future edit from quietly reintroducing them as trusted.
    const value = normalizeStructuredInput({
      ...request(),
      regionName: "Central Visayas (Region VII)",
      provinceName: "Cebu",
      cityName: "Cebu City",
      barangayName: "Lahug",
    });

    expect(value.regionName).toBeUndefined();
    expect(value.provinceName).toBeUndefined();
    expect(value.cityName).toBeUndefined();
    expect(value.barangayName).toBeUndefined();
  });

  it("keeps only the barangay CODE as the client's geographic input", () => {
    const value = normalizeStructuredInput(request());
    expect(value.psgcBarangayCode).toBe("043404001");
  });

  it("rebuilds from an allowlist, so an unknown key cannot ride along", () => {
    const value = normalizeStructuredInput({
      ...request(),
      verified: true,
      provider: "tomtom",
      isAdmin: true,
      addressId: 7,
    });

    expect(value.verified).toBeUndefined();
    expect(value.provider).toBeUndefined();
    expect(value.isAdmin).toBeUndefined();
    expect(value.addressId).toBeUndefined();
  });

  it("falls back to a known address type rather than storing anything", () => {
    expect(normalizeStructuredInput(request({ type: "home" })).type).toBe("home");
    expect(normalizeStructuredInput(request({ type: "office" })).type).toBe("office");
    // A value the UI cannot produce must not become storable.
    expect(normalizeStructuredInput(request({ type: "palace" })).type).toBe("home");
    expect(normalizeStructuredInput(request({ type: null })).type).toBe("home");
  });

  it("treats a whitespace-only required field as empty", () => {
    expect(normalizeStructuredInput(request({ streetRoad: "   " })).streetRoad).toBe("");
  });

  it("truncates to the column limits rather than overflowing them", () => {
    const value = normalizeStructuredInput(request({ streetRoad: "x".repeat(500) }));
    expect(value.streetRoad).toHaveLength(200);
  });
});

describe("resolveStructuredAddress — refusals", () => {
  it("refuses a request with no barangay", async () => {
    const result = await resolveStructuredAddress(request({ psgcBarangayCode: null }), {
      resolve: resolveAs(SANTA_ROSA),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/barangay/i);
  });

  it("refuses an unknown barangay code", async () => {
    // The resolver returning null means the code is not in the geography. The
    // message must not read as a typo the operator made.
    const result = await resolveStructuredAddress(request(), { resolve: resolveAs(null) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the address database/i);
  });

  it("refuses an address missing street-level detail, without a lookup", async () => {
    const resolve = resolveAs(SANTA_ROSA);
    const result = await resolveStructuredAddress(request({ houseBuildingNumber: "" }), { resolve });

    expect(result.ok).toBe(false);
    expect(result.errors.houseBuildingNumber).toBeTruthy();
    // Checked before the database is touched.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a malformed ZIP", async () => {
    const result = await resolveStructuredAddress(request({ postalCode: "402" }), {
      resolve: resolveAs(SANTA_ROSA),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/4 digits/);
  });

  it("refuses half a coordinate", async () => {
    // The CHECK constraint would reject this too; catching it here turns a 500
    // into a message.
    const result = await resolveStructuredAddress(
      request({ latitude: 14.5995, longitude: null }),
      { resolve: resolveAs(SANTA_ROSA) }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/together/i);
  });

  it("refuses an out-of-range coordinate", async () => {
    const result = await resolveStructuredAddress(
      request({ latitude: 91, longitude: 121 }),
      { resolve: resolveAs(SANTA_ROSA) }
    );
    expect(result.ok).toBe(false);
  });
});

describe("resolveStructuredAddress — the server's geography wins", () => {
  it("stores the derived names, discarding what the client claimed", async () => {
    // The attack this exists to stop: a client filing a Laguna barangay under a
    // Cebu city. The stored row must be Santa Rosa.
    const result = await resolveStructuredAddress(
      request({
        cityName: "Cebu City",
        provinceName: "Cebu",
        regionName: "Central Visayas (Region VII)",
      }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.components.city).toBe("Santa Rosa City");
    expect(result.value.components.province).toBe("Laguna");
    expect(result.value.components.region).toBe("CALABARZON (Region IV-A)");
    expect(result.value.components.barangay).toBe("Balibago");
  });

  it("does not reject on a stale name — it corrects it", async () => {
    // A barangay renamed after the address was saved must still be savable. The
    // server already knows the current name; refusing here would strand the row.
    const result = await resolveStructuredAddress(
      request({ cityName: "Santa Rosa (old name)" }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.components.city).toBe("Santa Rosa City");
  });

  it("composes formatted_address from the derived geography", async () => {
    const result = await resolveStructuredAddress(
      request({ subdivisionVillage: "Example Village" }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.formattedAddress).toBe(
      "8572 Winding Creek Boulevard, Example Village, Barangay Balibago, " +
        "Santa Rosa City, Laguna, CALABARZON (Region IV-A), 4026, Philippines"
    );
  });

  it("keeps delivery notes out of the stored address", async () => {
    const result = await resolveStructuredAddress(
      request({ landmark: "Near the main gate", additionalDetails: "Blue gate" }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.value.formattedAddress).not.toContain("main gate");
    expect(result.value.formattedAddress).not.toContain("Blue gate");
    // ...but they are still stored, as their own fields.
    expect(result.value.landmark).toBe("Near the main gate");
    expect(result.value.additionalDetails).toBe("Blue gate");
  });

  it("returns the leaf code so the row can reference the hierarchy", async () => {
    const result = await resolveStructuredAddress(request(), { resolve: resolveAs(SANTA_ROSA) });
    expect(result.value.psgcBarangayCode).toBe("043404001");
  });
});

describe("resolveStructuredAddress — the pin is a claim, never a verification", () => {
  it("never sets verified, even with a pin", async () => {
    // A dropped pin is where an operator says the door is. Nothing here may
    // present that as provider-confirmed.
    const result = await resolveStructuredAddress(
      request({ latitude: 14.3123, longitude: 121.1113 }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.verified).toBe(false);
    expect(result.value.provider).toBe("manual");
    expect(result.value.verifiedAt).toBeNull();
  });

  it("saves without a pin at all — the cascade is what makes it valid", async () => {
    const result = await resolveStructuredAddress(request(), { resolve: resolveAs(SANTA_ROSA) });

    expect(result.ok).toBe(true);
    expect(result.value.latitude).toBeNull();
    expect(result.value.longitude).toBeNull();
  });

  it("records a supplied ZIP as manual, so it survives later changes", async () => {
    const result = await resolveStructuredAddress(request({ postalCode: "4026" }), {
      resolve: resolveAs(SANTA_ROSA),
    });
    expect(result.value.postalCodeSource).toBe("manual");
  });
});

describe("resolveStructuredAddress — the province-less region", () => {
  it("saves a Metro Manila address with no province", async () => {
    // The failure this guards: a form that requires a province makes every NCR
    // address unsaveable. Here the chain says there is none, so none is required.
    const result = await resolveStructuredAddress(
      request({ psgcBarangayCode: "1339000001", postalCode: "1000", streetRoad: "Roxas Boulevard" }),
      { resolve: resolveAs(MANILA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.components.province).toBeNull();
    expect(result.value.formattedAddress).toBe(
      "8572 Roxas Boulevard, Barangay Ermita, City of Manila, " +
        "National Capital Region (NCR), 1000, Philippines"
    );
  });
});

describe("resolveStructuredAddress — the operational address type", () => {
  it("stores `operational` rather than folding it to the default", async () => {
    // The type reaches the row through `derived.type`, which came from the
    // allowlist in `normalizeStructuredInput`. A type the allowlist rejects is
    // silently replaced by `home`, so this is the assertion that the new value
    // is genuinely storable and not merely declared.
    expect(normalizeStructuredInput(request({ type: "operational" })).type).toBe("operational");

    const result = await resolveStructuredAddress(request({ type: "operational" }), {
      resolve: resolveAs(SANTA_ROSA),
    });
    expect(result.ok).toBe(true);
    expect(result.value.addressType).toBe("operational");
  });

  it("saves without a house number, and invents none", async () => {
    // The whole point: a curbside point has a road and a ZIP and no number. It
    // must save with the number ABSENT — not "N/A", not "0", because either would
    // be a fabricated fact about a real place that every later reader believes.
    const result = await resolveStructuredAddress(
      request({
        type: "operational",
        houseBuildingNumber: "",
        streetRoad: "Andrews Avenue",
        postalCode: "1300",
        psgcBarangayCode: "1339000001",
      }),
      { resolve: resolveAs(MANILA) }
    );

    expect(result.ok).toBe(true);
    expect(result.value.components.houseNumber).toBeNull();
    expect(result.value.formattedAddress).toBe(
      "Andrews Avenue, Barangay Ermita, City of Manila, " +
        "National Capital Region (NCR), 1300, Philippines"
    );
    // The composed address must not open on a stray separator where the number
    // would have been — that is what a placeholder would leave behind.
    expect(result.value.formattedAddress).not.toMatch(/^[,\s]/);
  });

  it("still refuses an operational address with no street", async () => {
    // One field is relaxed, not the whole street-level rule.
    const result = await resolveStructuredAddress(
      request({ type: "operational", houseBuildingNumber: "", streetRoad: "" }),
      { resolve: resolveAs(SANTA_ROSA) }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.streetRoad).toBeTruthy();
  });

  it("still refuses a personal address with no house number", async () => {
    // The exception must not have leaked into the default case.
    for (const type of ["home", "office", "other"]) {
      const result = await resolveStructuredAddress(
        request({ type, houseBuildingNumber: "" }),
        { resolve: resolveAs(SANTA_ROSA) }
      );
      expect(result.ok).toBe(false);
      expect(result.errors.houseBuildingNumber).toBeTruthy();
    }
  });

  it("reports the same refusal through the detail and geography stages", async () => {
    // `resolveStructuredAddress` checks the street detail BEFORE the lookup, so
    // the operational relaxation has to hold in stage 1 too — otherwise the
    // request would be refused without ever reaching where the type is read.
    const resolve = resolveAs(SANTA_ROSA);
    const result = await resolveStructuredAddress(
      request({ type: "operational", houseBuildingNumber: "", postalCode: "" }),
      { resolve }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.postalCode).toBeTruthy();
    expect(result.errors.houseBuildingNumber).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The form's payload and this module must agree on the key names
// ---------------------------------------------------------------------------

/**
 * THE BUG THESE EXIST FOR, and why every other test in this file was green while
 * the feature did not work.
 *
 * The cascade builds its value with `selectLevel`, and on 2026-09-24 that wrote
 * `barangayCode` — the form's own key — while `normalizeStructuredInput` read
 * `psgcBarangayCode`. Both halves were tested, against themselves: every test in
 * this file builds its request with the SERVER's key, and `structured.test.js`
 * builds values with the FORM's. Neither ever handed one to the other, so the
 * mismatch was invisible and every gate passed. In the browser it surfaced as
 * "Select a barangay." with a barangay selected, on all four cascade surfaces.
 *
 * The lesson is not "add a test for the driver route" — it is that a key crossing
 * a boundary needs a test that CROSSES it. These two do, in opposite directions:
 * one drives the form's constructors into this module, the other asserts the key
 * this module reads is the key the form declares. A rename on either side fails
 * here rather than in an operator's face.
 */
describe("the form's value and the server's input agree", () => {
  /** A value built the way `AddressFormDialog` builds one, from the real helpers. */
  function formValue({ barangayCode, streetRoad, postalCode, houseBuildingNumber = "8572" }) {
    // Read the key from the form's OWN declaration rather than hardcoding it, so
    // this test follows a rename instead of silently testing a dead name.
    const [codeKey] = CASCADE_LEVEL_KEYS.barangay;

    let value = EMPTY_STRUCTURED_ADDRESS;
    value = selectLevel(value, "region", {
      regionCode: SANTA_ROSA.region.code,
      regionName: SANTA_ROSA.region.name,
    });
    value = selectLevel(value, "province", {
      provinceCode: SANTA_ROSA.province.code,
      provinceName: SANTA_ROSA.province.name,
    });
    value = selectLevel(value, "city", {
      cityCode: SANTA_ROSA.city.code,
      cityName: SANTA_ROSA.city.name,
      cityHasNoProvince: false,
    });
    value = selectLevel(value, "barangay", {
      [codeKey]: barangayCode,
      barangayName: SANTA_ROSA.barangay.name,
    });
    value = editDetail(value, "houseBuildingNumber", houseBuildingNumber);
    value = editDetail(value, "streetRoad", streetRoad);
    value = editDetail(value, "postalCode", postalCode);
    return value;
  }

  it("resolves a value built by the form's own constructors", async () => {
    const result = await resolveStructuredAddress(
      formValue({
        barangayCode: SANTA_ROSA.barangay.code,
        streetRoad: "Winding Creek Boulevard",
        postalCode: "4026",
      }),
      { resolve: resolveAs(SANTA_ROSA) }
    );

    expect(result.ok).toBe(true);
    // Not merely accepted — the code survived to the stored value, which is what
    // proves the server actually READ it rather than defaulting past it.
    expect(result.value.psgcBarangayCode).toBe(SANTA_ROSA.barangay.code);
    expect(result.value.components.barangay).toBe("Balibago");
    expect(result.value.components.city).toBe("Santa Rosa City");
  });

  it("reads the barangay code under the key the cascade declares", () => {
    // The other direction, and the one that fails loudly on a one-sided rename:
    // whatever key `CASCADE_LEVEL_KEYS` names for the barangay is the key this
    // module must read. Renaming the form's key without this module would make
    // this assertion send an unknown key and get `undefined` back.
    const [codeKey] = CASCADE_LEVEL_KEYS.barangay;
    expect(normalizeStructuredInput({ [codeKey]: SANTA_ROSA.barangay.code }).psgcBarangayCode).toBe(
      SANTA_ROSA.barangay.code
    );
  });

  it("refuses the same value with the barangay code under any other name", () => {
    // The guard's own guard. If `barangayCode` were silently accepted as well —
    // the tempting one-line "fix" — this test would be the thing that says the
    // server is reading a field nothing writes.
    expect(normalizeStructuredInput({ barangayCode: SANTA_ROSA.barangay.code }).psgcBarangayCode).toBe(
      null
    );
  });
});
