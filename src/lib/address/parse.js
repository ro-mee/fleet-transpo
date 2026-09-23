// TomTom Search API payload -> the app's AddressValue. Pure: no fetch, no cache,
// no env — the vitest suite exercises every branch of this directly.
//
// TomTom returns the same `address` object shape from both search and reverse
// geocode, so `toAddressValue` is the single mapping used by both paths. Search
// wraps it in `{ results: [...] }` with `position` on the result; reverse wraps
// it in `{ addresses: [{ address, position }] }`.
//
// PHILIPPINE COMPONENT MAPPING IS AN ASSUMPTION, NOT A GUARANTEE.
// The names below are TomTom's global vocabulary, and which field carries the
// barangay for a Philippine address was NOT verified against live data when this
// was written. `PH_COMPONENT_MAP` is therefore a single, reviewable table rather
// than field-by-field logic scattered through the function, so correcting it
// after the live check is a one-line edit. Two rules hold regardless of what
// that check finds:
//
//   1. A component the provider did not supply stays null. We never infer a
//      barangay from a postal code, a city from a province, or anything else.
//   2. `formattedAddress` is authoritative for display even when every
//      structured component is null, so an unmapped address still renders
//      correctly rather than degrading to an empty panel.

import { normalizePostalCode } from "./postal";

export const PROVIDER_TOMTOM = "tomtom";

/**
 * TomTom address field -> our component key.
 *
 * `province` deliberately reads `countrySecondarySubdivision` first and falls
 * back to `countrySubdivisionName`: for Metro Manila, TomTom reports the
 * province level as "Metro Manila" and there is no separate region, while for
 * provincial addresses the two differ (e.g. "Cebu" vs "Central Visayas").
 * `region` takes whatever is left.
 */
export const PH_COMPONENT_MAP = Object.freeze({
  houseNumber: "streetNumber",
  street: "streetName",
  barangay: "municipalitySubdivision",
  city: "municipality",
  province: "countrySecondarySubdivision",
  region: "countrySubdivisionName",
});

/** Trim a provider string, collapsing whitespace. Blank -> null, never "". */
function text(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A finite coordinate in range, or null. Guards against provider oddities. */
function coordinate(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

/**
 * The all-null component set. Every AddressValue carries the full shape so
 * consumers never have to guard for missing keys.
 * @returns {object}
 */
export function emptyComponents() {
  return {
    houseNumber: null,
    unitNumber: null,
    building: null,
    street: null,
    subdivision: null,
    barangay: null,
    city: null,
    municipality: null,
    province: null,
    region: null,
    country: null,
  };
}

/**
 * The empty AddressValue — an address that has been typed but not validated.
 * @param {string} [raw]
 * @returns {object}
 */
export function emptyAddressValue(raw = "") {
  return {
    raw,
    addressId: null,
    formattedAddress: "",
    components: emptyComponents(),
    postalCode: null,
    postalCodeSource: null,
    latitude: null,
    longitude: null,
    verified: false,
    provider: null,
    providerPlaceId: null,
    verifiedAt: null,
  };
}

/**
 * Build the structured components from a TomTom `address` object.
 *
 * Only mapped fields are read. `unitNumber`, `building` and `subdivision` have
 * no TomTom counterpart — a geocoder cannot know which floor of a building a
 * person lives on — so they stay null rather than being guessed at from the
 * freeform string.
 *
 * @param {object|null} address  TomTom `address`
 * @returns {object}             the component set
 */
export function parseComponents(address) {
  const components = emptyComponents();
  if (!address || typeof address !== "object") return components;
  for (const [key, providerField] of Object.entries(PH_COMPONENT_MAP)) {
    components[key] = text(address[providerField]);
  }
  // Metro Manila reports no separate region, so the province value doubles as
  // the region. This is a copy of a value the provider DID supply, not an
  // inference — and it is only filled when the provider gave us no region.
  if (!components.region && components.province) components.region = components.province;
  components.country = text(address.country) || text(address.countryCode) || null;
  return components;
}

/**
 * A TomTom result (or reverse-geocode address entry) -> AddressValue.
 *
 * `verified` is true only here — the one place where coordinates and a
 * formatted address arrived together from the provider. Nothing in the UI may
 * set it some other way.
 *
 * @param {object} input
 * @param {object} [input.address]    TomTom `address`
 * @param {object} [input.position]   `{ lat, lon }`
 * @param {string} [input.id]         provider place id
 * @param {string} [input.rawInput]   what the operator actually typed
 * @param {string} [input.provider]
 * @returns {object|null}             null when there is no usable address
 */
export function toAddressValue({ address, position, id, rawInput, provider = PROVIDER_TOMTOM } = {}) {
  const formatted = text(address?.freeformAddress);
  if (!formatted) return null;

  const latitude = coordinate(position?.lat, 90);
  const longitude = coordinate(position?.lon, 180);
  // A pair is all-or-nothing; half a coordinate is worse than none, because it
  // reads as "located" to every downstream consumer.
  const hasPosition = latitude !== null && longitude !== null;

  const components = parseComponents(address);
  const postalCode = normalizePostalCode(address?.postalCode);

  return {
    raw: text(rawInput) || formatted,
    addressId: null,
    formattedAddress: formatted,
    components,
    postalCode,
    // Records WHICH side asserted the ZIP. The address-change rule keys off
    // this: a provider ZIP is a property of the old address and must be
    // cleared, while a hand-typed one is the operator's own claim and is kept.
    postalCodeSource: postalCode ? "provider" : null,
    latitude: hasPosition ? latitude : null,
    longitude: hasPosition ? longitude : null,
    verified: hasPosition,
    provider,
    providerPlaceId: text(id),
    verifiedAt: hasPosition ? new Date().toISOString() : null,
  };
}

/**
 * Parse a TomTom Search API response into suggestions.
 *
 * Suggestions carry ONLY what a listbox needs to render — id, label, secondary
 * line. Coordinates are deliberately absent: the browser never receives
 * coordinates it could then submit as its own, so `/api/address/geocode` stays
 * the single place a location becomes authoritative.
 *
 * @param {object} payload
 * @returns {Array<{ placeId: string, label: string, secondary: string }>}
 */
export function parseSearchResponse(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((result) => {
      const address = result?.address;
      const label = text(address?.freeformAddress);
      if (!label || !result?.id) return null;
      // The secondary line names the locality, which is what disambiguates two
      // branches of the same street in different cities.
      const secondary =
        text(address?.municipalitySubdivision) ||
        text(address?.municipality) ||
        text(address?.countrySubdivisionName) ||
        "";
      return { placeId: String(result.id), label, secondary };
    })
    .filter(Boolean);
}

/**
 * Parse a TomTom reverse-geocode response into an AddressValue.
 * @param {object} payload
 * @param {string} [rawInput]
 * @returns {object|null}
 */
export function parseReverseResponse(payload, rawInput) {
  const entry = Array.isArray(payload?.addresses) ? payload.addresses[0] : null;
  if (!entry?.address) return null;
  return toAddressValue({
    address: entry.address,
    position: entry.position,
    id: entry.address?.id,
    rawInput,
  });
}
