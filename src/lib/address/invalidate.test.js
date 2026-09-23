// Tests for the anti-stale rule.
//
// The load-bearing assertions are that EVERY derived field is cleared together,
// and that the clear is a single indivisible operation. If a future edit makes
// this function partial — clearing the coordinate but keeping the barangay, or
// keeping a provider ZIP — the "Address B with Latitude A" bug is back, and it
// is back in a form nobody would notice in review.
import { describe, it, expect } from "vitest";
import { invalidateForInput, confirmResolved, isBlankAddress } from "./invalidate";
import { emptyComponents } from "./parse";

/** A fully resolved, verified address — the state right after a selection. */
function verifiedValue(overrides = {}) {
  return {
    raw: "29 Ninang Virginia",
    addressId: 7,
    formattedAddress: "29 Ninang Virginia, Deparo, Caloocan City, Metro Manila, 1421",
    components: {
      houseNumber: "29", unitNumber: null, building: null, street: "Ninang Virginia",
      subdivision: null, barangay: "Deparo", city: "Caloocan City", municipality: null,
      province: "Metro Manila", region: "Metro Manila", country: "Philippines",
    },
    postalCode: "1421",
    postalCodeSource: "provider",
    latitude: 14.7,
    longitude: 121.0,
    verified: true,
    provider: "tomtom",
    providerPlaceId: "PH/POI/1",
    verifiedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("invalidateForInput — clearing the derived fields", () => {
  it("clears the coordinate, the verified flag and the place identity together", () => {
    const next = invalidateForInput(verifiedValue(), "29 Ninang Virginia, Deparo");

    // The pair that must never survive a text edit.
    expect(next.latitude).toBeNull();
    expect(next.longitude).toBeNull();
    expect(next.verified).toBe(false);
    expect(next.verifiedAt).toBeNull();

    // The provenance of that pair.
    expect(next.provider).toBeNull();
    expect(next.providerPlaceId).toBeNull();
    expect(next.addressId).toBeNull();
    expect(next.formattedAddress).toBe("");

    // Structured components are properties of the OLD address just as much as
    // the coordinate is. A stale barangay beside a new street is the same class
    // of bug.
    expect(next.components).toEqual(emptyComponents());
    expect(next.components.barangay).toBeNull();
  });

  it("keeps the text the operator is typing", () => {
    const next = invalidateForInput(verifiedValue(), "29 Ninang Virginia, Deparo");
    expect(next.raw).toBe("29 Ninang Virginia, Deparo");
  });

  it("does not mutate the value it was handed", () => {
    const previous = verifiedValue();
    invalidateForInput(previous, "something else");
    expect(previous.latitude).toBe(14.7);
    expect(previous.verified).toBe(true);
    expect(previous.providerPlaceId).toBe("PH/POI/1");
  });

  it("survives being called with nothing", () => {
    expect(invalidateForInput(null, "abc").raw).toBe("abc");
    expect(invalidateForInput(undefined, "").verified).toBe(false);
    expect(invalidateForInput(null, "abc").components).toEqual(emptyComponents());
  });
});

describe("invalidateForInput — postal code provenance", () => {
  it("discards a provider-sourced ZIP, because it described the old address", () => {
    const next = invalidateForInput(verifiedValue(), "a different street");
    expect(next.postalCode).toBeNull();
    expect(next.postalCodeSource).toBeNull();
    expect(next.postalCodeUnconfirmed).toBe(false);
  });

  it("retains a manually entered ZIP and flags it as unconfirmed", () => {
    // The operator asserted this ZIP — often because the provider had none.
    // Discarding it would destroy the only copy of a fact they supplied.
    const previous = verifiedValue({ postalCode: "1421", postalCodeSource: "manual" });
    const next = invalidateForInput(previous, "a different street");

    expect(next.postalCode).toBe("1421");
    expect(next.postalCodeSource).toBe("manual");
    // Kept, but explicitly not a settled value for the new text.
    expect(next.postalCodeUnconfirmed).toBe(true);
  });

  it("does not flag a ZIP that was never there", () => {
    const previous = verifiedValue({ postalCode: null, postalCodeSource: null });
    const next = invalidateForInput(previous, "a different street");
    expect(next.postalCode).toBeNull();
    expect(next.postalCodeUnconfirmed).toBe(false);
  });

  it("does not retain a ZIP left over from a cleared address", () => {
    // A manual ZIP with nothing else is still the operator's assertion, so it
    // is retained even when unverified — the flag, not deletion, is the safety.
    const previous = verifiedValue({
      postalCode: "1421", postalCodeSource: "manual", verified: false, latitude: null, longitude: null,
    });
    const next = invalidateForInput(previous, "typed");
    expect(next.postalCode).toBe("1421");
    expect(next.postalCodeUnconfirmed).toBe(true);
  });
});

describe("confirmResolved", () => {
  it("clears the unconfirmed flag once a real answer arrives", () => {
    const resolved = verifiedValue({ postalCode: "1421", postalCodeSource: "provider" });
    expect(confirmResolved({ ...resolved, postalCodeUnconfirmed: true }).postalCodeUnconfirmed).toBe(false);
  });

  it("does not alter the resolved address itself", () => {
    const resolved = verifiedValue();
    const confirmed = confirmResolved(resolved);
    expect(confirmed.latitude).toBe(14.7);
    expect(confirmed.postalCode).toBe("1421");
    expect(confirmed.components.barangay).toBe("Deparo");
  });
});

describe("isBlankAddress", () => {
  it("is true for nothing, and for an untouched value", () => {
    expect(isBlankAddress(null)).toBe(true);
    expect(isBlankAddress(undefined)).toBe(true);
    expect(isBlankAddress(invalidateForInput(null, ""))).toBe(true);
    expect(isBlankAddress(invalidateForInput(null, "   "))).toBe(true);
  });

  it("is false once there is text or a selection", () => {
    expect(isBlankAddress(invalidateForInput(null, "Deparo"))).toBe(false);
    expect(isBlankAddress(verifiedValue())).toBe(false);
  });
});
