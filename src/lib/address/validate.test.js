// Tests for server-side address validation — the security boundary.
//
// The most important assertions in this file are the anti-spoofing ones. A
// browser can post any JSON it likes, including `verified: true` and a pair of
// coordinates for a place it never looked up. These tests prove that the server
// ignores that entirely and stores what the PROVIDER says instead, and that a
// mismatch between the two is treated as a stale pair rather than reconciled in
// the client's favour.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./provider", () => ({
  addressGeocoder: { name: "tomtom", search: vi.fn(), geocode: vi.fn(), reverse: vi.fn() },
}));

import { addressGeocoder } from "./provider";
import {
  resolveAddress,
  normalizeAddressInput,
  structuralError,
  ADDRESS_MODE,
  COORDINATE_MISMATCH_TOLERANCE_M,
} from "./validate";

// Caloocan City, the worked example from the feature request.
const PROVIDER_LAT = 14.7;
const PROVIDER_LNG = 121.0;

/** What the provider says the place is. */
function providerValue(overrides = {}) {
  return {
    raw: "29 Ninang Virginia",
    addressId: null,
    formattedAddress: "29 Ninang Virginia, Deparo, Caloocan City, Metro Manila, 1421",
    components: {
      houseNumber: "29", unitNumber: null, building: null, street: "Ninang Virginia",
      subdivision: null, barangay: "Deparo", city: "Caloocan City", municipality: null,
      province: "Metro Manila", region: "Metro Manila", country: "Philippines",
    },
    postalCode: "1421",
    postalCodeSource: "provider",
    latitude: PROVIDER_LAT,
    longitude: PROVIDER_LNG,
    verified: true,
    provider: "tomtom",
    providerPlaceId: "PH/POI/1",
    verifiedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

const operational = { mode: ADDRESS_MODE.OPERATIONAL };
const personal = { mode: ADDRESS_MODE.PERSONAL };

beforeEach(() => {
  vi.clearAllMocks();
  addressGeocoder.geocode.mockResolvedValue(providerValue());
});

describe("normalizeAddressInput", () => {
  it("rebuilds the value from an allowlist, dropping unexpected keys", () => {
    const normalized = normalizeAddressInput({
      formattedAddress: "Somewhere",
      isAdmin: true,
      role: "super_admin",
      components: { city: "Caloocan City", evil: "x" },
    });
    expect(normalized.formattedAddress).toBe("Somewhere");
    expect(normalized).not.toHaveProperty("isAdmin");
    expect(normalized).not.toHaveProperty("role");
    expect(normalized.components).not.toHaveProperty("evil");
  });

  it("always reports verified false — the flag is never read from input", () => {
    expect(normalizeAddressInput({ verified: true }).verified).toBe(false);
  });

  it("survives non-object input", () => {
    expect(normalizeAddressInput(null).formattedAddress).toBe("");
    expect(normalizeAddressInput("nope").formattedAddress).toBe("");
    expect(normalizeAddressInput([1, 2]).formattedAddress).toBe("");
  });

  it("treats blank component strings as absent", () => {
    const normalized = normalizeAddressInput({ components: { city: "  ", street: "" } });
    expect(normalized.components.city).toBeNull();
    expect(normalized.components.street).toBeNull();
  });
});

describe("structuralError", () => {
  const base = normalizeAddressInput({});

  it("rejects half a coordinate pair", () => {
    expect(structuralError({ ...base, latitude: 14.7, longitude: null })).toMatch(/together/);
    expect(structuralError({ ...base, latitude: null, longitude: 121 })).toMatch(/together/);
  });

  it("rejects out-of-range coordinates from the raw submission", () => {
    // 999 is coerced to null by normalization, so the range check has to read
    // the raw value — otherwise a bad coordinate would look like an absent one
    // and fall through as a savable manual address.
    expect(structuralError(base, 999, 121)).toBe("Latitude must be between -90 and 90.");
    expect(structuralError(base, 14.7, 999)).toBe("Longitude must be between -180 and 180.");
  });

  it("rejects a malformed manually entered ZIP", () => {
    const value = { ...base, postalCode: "142", postalCodeSource: "manual" };
    expect(structuralError(value)).toMatch(/4 digits/);
  });

  it("accepts a complete pair and an absent one", () => {
    expect(structuralError({ ...base, latitude: 14.7, longitude: 121 })).toBeNull();
    expect(structuralError(base)).toBeNull();
  });
});

describe("resolveAddress — anti-spoofing", () => {
  it("ignores a client-claimed verified:true with no place id", async () => {
    const result = await resolveAddress(
      { verified: true, formattedAddress: "Fabricated Place", latitude: 14.7, longitude: 121 },
      operational
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must be verified/);
  });

  it("never calls the provider when the client supplies no place id", async () => {
    await resolveAddress({ formattedAddress: "Somewhere", latitude: 1, longitude: 1 }, personal);
    expect(addressGeocoder.geocode).not.toHaveBeenCalled();
  });

  it("takes coordinates from the provider, not from the request", async () => {
    const result = await resolveAddress(
      {
        formattedAddress: "29 Ninang Virginia",
        providerPlaceId: "PH/POI/1",
        // A plausible-looking but wrong pair for the same place id.
        latitude: PROVIDER_LAT + 0.0002,
        longitude: PROVIDER_LNG + 0.0002,
      },
      operational
    );
    expect(result.ok).toBe(true);
    expect(result.value.latitude).toBe(PROVIDER_LAT);
    expect(result.value.longitude).toBe(PROVIDER_LNG);
    expect(result.value.verified).toBe(true);
  });

  it("rejects a stale pair — coordinates that do not match the selected address", async () => {
    // ~2.2 km away: the signature of "Address B submitted with Address A's
    // coordinates", which is exactly what must never reach the database.
    const result = await resolveAddress(
      {
        formattedAddress: "A different address entirely",
        providerPlaceId: "PH/POI/1",
        latitude: 14.72,
        longitude: 121.02,
      },
      personal
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/do not match/i);
  });

  it("accepts drift well inside the tolerance", async () => {
    // ~11 m — ordinary rounding, not a different place.
    const result = await resolveAddress(
      {
        formattedAddress: "29 Ninang Virginia",
        providerPlaceId: "PH/POI/1",
        latitude: PROVIDER_LAT + 0.0001,
        longitude: PROVIDER_LNG,
      },
      operational
    );
    expect(result.ok).toBe(true);
    expect(result.value.latitude).toBe(PROVIDER_LAT);
  });

  it("keeps the tolerance meaningfully below an address-sized gap", () => {
    expect(COORDINATE_MISMATCH_TOLERANCE_M).toBeLessThan(200);
  });
});

describe("resolveAddress — enforcement modes", () => {
  it("refuses an unverified OPERATIONAL address", async () => {
    const result = await resolveAddress({ formattedAddress: "Somewhere", raw: "Somewhere" }, operational);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must be verified/);
  });

  it("allows an unverified PERSONAL address, badged rather than blocked", async () => {
    const result = await resolveAddress({ formattedAddress: "Somewhere", raw: "Somewhere" }, personal);
    expect(result.ok).toBe(true);
    expect(result.value.verified).toBe(false);
    expect(result.value.formattedAddress).toBe("Somewhere");
  });

  it("degrades a personal address when the provider cannot resolve the place", async () => {
    addressGeocoder.geocode.mockResolvedValue(null);
    const result = await resolveAddress(
      { formattedAddress: "Somewhere", raw: "Somewhere", providerPlaceId: "PH/GONE" },
      personal
    );
    expect(result.ok).toBe(true);
    expect(result.value.verified).toBe(false);
  });

  it("refuses an operational address when the provider cannot resolve the place", async () => {
    addressGeocoder.geocode.mockResolvedValue(null);
    const result = await resolveAddress(
      { formattedAddress: "Somewhere", providerPlaceId: "PH/GONE" },
      operational
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be verified/i);
  });

  it("requires an address for an operational record but not a personal one", async () => {
    expect((await resolveAddress({}, operational)).ok).toBe(false);
    expect((await resolveAddress({}, operational)).error).toBe("Address is required.");

    const blank = await resolveAddress({}, personal);
    expect(blank.ok).toBe(true);
    expect(blank.value.formattedAddress).toBe("");
  });
});

describe("resolveAddress — postal code independence", () => {
  it("preserves a manually entered ZIP through geocoding", async () => {
    const result = await resolveAddress(
      {
        formattedAddress: "29 Ninang Virginia",
        providerPlaceId: "PH/POI/1",
        postalCode: "1422",
        postalCodeSource: "manual",
      },
      operational
    );
    expect(result.ok).toBe(true);
    expect(result.value.postalCode).toBe("1422");
    expect(result.value.postalCodeSource).toBe("manual");
  });

  it("lets the provider's ZIP stand when the operator did not assert one", async () => {
    const result = await resolveAddress(
      { formattedAddress: "29 Ninang Virginia", providerPlaceId: "PH/POI/1" },
      operational
    );
    expect(result.value.postalCode).toBe("1421");
    expect(result.value.postalCodeSource).toBe("provider");
  });

  it("verifies a location even when no ZIP exists at all", async () => {
    // The two states are independent: a verified location with no ZIP is a
    // first-class outcome, not a failure.
    addressGeocoder.geocode.mockResolvedValue(
      providerValue({ postalCode: null, postalCodeSource: null })
    );
    const result = await resolveAddress(
      { formattedAddress: "29 Ninang Virginia", providerPlaceId: "PH/POI/1" },
      operational
    );
    expect(result.ok).toBe(true);
    expect(result.value.verified).toBe(true);
    expect(result.value.postalCode).toBeNull();
  });
});
