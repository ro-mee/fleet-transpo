// Tests for lifting a PICKED address out of a request body.
//
// The helper has exactly two jobs, and only one of them can be tested in
// isolation: deciding whether a pick ARRIVED, and re-keying a refusal so it
// says which of a driver's two addresses it is about. Everything that decides
// whether the pick is ACCEPTABLE belongs to `validate-structured.js` and is
// tested there; these tests deliberately do not restate those rules.
//
// The geography resolver is mocked at the seam the validator reads it through,
// so `resolvePickedAddress` still runs the real normalization, the real detail
// rules and the real composition. Mocking the helper's internals instead would
// test a re-implementation rather than the path the routes take.
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveBarangayChain = vi.fn();
vi.mock("@/lib/geo/psgc", () => ({
  resolveBarangayChain: (...args) => resolveBarangayChain(...args),
}));

import { resolvePickedAddress } from "./picked";

/** A resolved chain, shaped exactly like `resolveBarangayChain`'s return. */
const SANTA_ROSA = {
  region: { code: "0400000000", name: "CALABARZON (Region IV-A)" },
  province: { code: "0434000000", name: "Laguna" },
  city: { code: "0434040000", name: "Santa Rosa City" },
  barangay: { code: "043404001", name: "Balibago" },
};

/** The minimum a savable address needs, plus its barangay choice. */
function pick(overrides = {}) {
  return {
    type: "home",
    psgcBarangayCode: "043404001",
    houseBuildingNumber: "8572",
    streetRoad: "Winding Creek Boulevard",
    postalCode: "4026",
    ...overrides,
  };
}

beforeEach(() => {
  resolveBarangayChain.mockReset();
  resolveBarangayChain.mockResolvedValue(SANTA_ROSA);
});

describe("resolvePickedAddress — what counts as absent", () => {
  it("treats a missing field as no pick, and looks nothing up", async () => {
    // The distinction the whole omitted-vs-empty rule rests on: a rename that
    // omits the address must not be read as an address change. Returning null
    // rather than an empty value is how the caller can tell the two apart.
    const result = await resolvePickedAddress({ first_name: "Juan" });
    expect(result).toEqual({ ok: true, value: null });
    expect(resolveBarangayChain).not.toHaveBeenCalled();
  });

  it("treats an explicit null as absent too", async () => {
    const result = await resolvePickedAddress({ structured_address: null });
    expect(result).toEqual({ ok: true, value: null });
  });

  it("reads the field it was told to read, not a fixed one", async () => {
    // The driver surface passes two different fields through this function; a
    // hardcoded `structured_address` would silently ignore the second.
    const result = await resolvePickedAddress(
      { emergency_structured_address: pick() },
      "emergency_structured_address"
    );
    expect(result.ok).toBe(true);
    expect(result.value.psgcBarangayCode).toBe("043404001");
  });

  it("finds no pick in a body that cannot carry one", async () => {
    // A body of the wrong shape is the route schema's to report. Reporting it
    // here as well would give one malformed request two different first errors.
    for (const body of [null, undefined, "nope", 42, []]) {
      expect(await resolvePickedAddress(body)).toEqual({ ok: true, value: null });
    }
  });
});

describe("resolvePickedAddress — what a pick resolves to", () => {
  it("returns the server's resolution, not the client's claim", async () => {
    // Same rule the sibling validator test asserts: geography text sent
    // alongside the code is discarded, and the STORED value is what is checked.
    const result = await resolvePickedAddress({
      structured_address: {
        ...pick(),
        regionName: "Central Visayas (Region VII)",
        provinceName: "Cebu",
        cityName: "Cebu City",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.value.components.city).toBe("Santa Rosa City");
    expect(result.value.components.province).toBe("Laguna");
    expect(result.value.formattedAddress).toContain("Santa Rosa City");
  });

  it("carries a real pin through, because a home has no other owner", async () => {
    // The driver surface is the first caller that can legitimately drop a pin —
    // the operational ones hide the map. The pair arrives as a pair.
    const result = await resolvePickedAddress({
      structured_address: pick({ latitude: 14.3121, longitude: 121.1113 }),
    });
    expect(result.value.latitude).toBeCloseTo(14.3121);
    expect(result.value.longitude).toBeCloseTo(121.1113);
  });

  it("never claims a picked address was verified", async () => {
    const result = await resolvePickedAddress({ structured_address: pick() });
    expect(result.value.verified).toBe(false);
    expect(result.value.provider).toBe("manual");
  });
});

describe("resolvePickedAddress — the shape of a refusal", () => {
  it("namespaces field errors with the address they came from", async () => {
    // A driver carries two addresses. `errors.streetRoad` alone cannot say
    // which one is wrong, and the response carries the whole object.
    const result = await resolvePickedAddress(
      { emergency_structured_address: { type: "home", psgcBarangayCode: "043404001" } },
      "emergency_structured_address"
    );

    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toContain("emergency_structured_address.streetRoad");
    expect(Object.keys(result.errors)).toContain("emergency_structured_address.postalCode");
  });

  it("refuses an unknown barangay code without inventing a geography", async () => {
    resolveBarangayChain.mockResolvedValue(null);
    const result = await resolvePickedAddress({ structured_address: pick() });

    expect(result.ok).toBe(false);
    expect(result.errors["structured_address.barangay"]).toBe("Unknown barangay code.");
  });

  it("refuses a half coordinate, keyed to the address as a whole", async () => {
    // The pin rules have no single field to blame — the pair is the subject —
    // so this takes the bare-field key rather than a namespaced one.
    const result = await resolvePickedAddress({
      structured_address: pick({ latitude: 14.3121 }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.structured_address).toBe(
      "Latitude and longitude must be provided together."
    );
  });

  it("refuses a supplied empty string rather than reading it as an omission", async () => {
    // The counterpart to the absent-field case above: this was SUPPLIED, and
    // reading it as "leave the stored address alone" is the failure the
    // locations PUT exists to avoid.
    const result = await resolvePickedAddress({ structured_address: "" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it("checks the street detail before it looks any geography up", async () => {
    // A request with no house number should not cost a query.
    await resolvePickedAddress({ structured_address: { psgcBarangayCode: "043404001" } });
    expect(resolveBarangayChain).not.toHaveBeenCalled();
  });
});
