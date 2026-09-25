// TomTom Search API payload -> the app's AddressValue. Pure: no fetch, no cache,
// no env — the vitest suite exercises every branch of this directly.
//
// TomTom returns the same `address` object shape from both search and reverse
// geocode, so `toAddressValue` is the single mapping used by both paths. Search
// wraps it in `{ results: [...] }` with `position` on the result; reverse wraps
// it in `{ addresses: [{ address, position }] }`.
//
// PHILIPPINE COMPONENT MAPPING WAS CHECKED AGAINST LIVE DATA, AND THE BARANGAY
// MAPPING FAILED. On 2026-09-25 four real reverse-geocode payloads were obtained
// for Philippine points, and TomTom's `municipalitySubdivision` turned out to
// carry the DISTRICT, not the barangay. Caloocan is the proof: it returns
// "Maypajo" while the provider's own `freeformAddress` for the same point reads
// "Tamban Street, Maypajo, Barangay 28, Caloocan City…" — it names the district
// and the barangay separately, and the structured field holds the district.
//
// The failure is INCONSISTENT, which is worse than a uniformly wrong field: two
// of the four (Cebu City's "Guadalupe", Quezon City's "Balara") happen to be real
// barangays, and one (Davao's "Calinan") is another district. Nothing downstream
// can tell a correct mapping from a mislabel, so the field is not mapped at all
// rather than being mapped and hoped for.
//
// `barangay` is therefore ABSENT from the table, the freeform is NOT parsed for
// it — that would be the same fuzzy inference this design refuses, and three of
// the four payloads never spell the barangay out at all — and the authoritative
// source for a Philippine barangay stays the PSGC cascade, which derives it from
// a code the operator chose rather than a string a provider sent.
//
// `PH_COMPONENT_MAP` remains a single, reviewable table so a future correction is
// a one-line edit. Three rules hold regardless:
//
//   1. A component the provider did not supply stays null. We never infer a
//      barangay from a postal code, a city from a province, or anything else.
//   2. `formattedAddress` is authoritative for display even when every
//      structured component is null, so an unmapped address still renders
//      correctly rather than degrading to an empty panel.
//   3. A provider string reaches `components` only when its meaning was measured.
//      `municipalitySubdivision` is the field that failed that test.
//
// CALLER STATUS — 2026-09-25: the mapping half below has no production caller.
// `providers/tomtom.js` was its only reader, and it was deleted with the rest of the
// unreferenced provider layer (`/api/address/search`, `/api/address/geocode`,
// `provider.js`, task #31) — every forward-geocoding endpoint answers 403, so those
// routes could only ever have returned `[]` and `502`. What stays in live use here is
// the empty-value vocabulary: `emptyAddressValue` and `emptyComponents` are imported by
// `validate-structured.js` and `invalidate.js`. `toAddressValue`, `parseReverseGeocode`
// and `PH_COMPONENT_MAP` are kept deliberately — this file is where the measured
// falsification above is recorded, and `parse.test.js` holds the four real payloads it
// rests on. Tested history, not dead code to sweep.

import { normalizePostalCode } from "./postal";

export const PROVIDER_TOMTOM = "tomtom";

/**
 * TomTom address field -> our component key.
 *
 * `barangay` is deliberately ABSENT. See the header: `municipalitySubdivision`
 * was measured to carry the district — sometimes, inconsistently — and the
 * freeform is not parsed for the barangay either. The authoritative barangay is
 * a chosen PSGC code, never a provider string.
 *
 * `province` reads `countrySecondarySubdivision`, which is a real province for a
 * provincial address ("Cebu", "Davao del Sur") but a REGION for Metro Manila
 * ("Metro Manila"). That one is corrected in `parseComponents`, not here, because
 * the correction depends on which region the address is in.
 *
 * `region` takes `countrySubdivisionName` — also measured: "Central Visayas",
 * "Davao Region", "National Capital Region", all correct.
 */
export const PH_COMPONENT_MAP = Object.freeze({
  houseNumber: "streetNumber",
  street: "streetName",
  city: "municipality",
  province: "countrySecondarySubdivision",
  region: "countrySubdivisionName",
});

/**
 * The regions that have no province level, so a secondary-subdivision value for
 * them is the region's own name repeated rather than a province.
 *
 * The Philippine Standard Geographic Code gives the National Capital Region no
 * provinces, and TomTom reports "Metro Manila" at the province level for it while
 * also reporting "National Capital Region" at the region level — the same region
 * under two names, one of which would land in `province`. NCR is the only region
 * in the country without provinces, so this set is exhaustive and closed: it is a
 * recorded geographic fact, not a name heuristic, and it is the narrow exception
 * to "map what the provider sent".
 *
 * Both spellings are listed because the provider uses both — `Metro Manila` at
 * the province level, `National Capital Region` at the region level — and either
 * one appearing at either level means the address is in NCR.
 */
const REGIONS_WITHOUT_PROVINCES = new Set(["Metro Manila", "National Capital Region"]);

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
 * freeform string. `barangay` is null for the reason in the header: the field
 * that would fill it was measured to hold the district.
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
  // Metro Manila has no province, so the value TomTom reports at that level is
  // the region's own name. Null it. This has to run BEFORE the fallback below:
  // otherwise the fallback would copy the value straight back out of `province`
  // and into `region`, which is where it came from in the first place.
  //
  // Either spelling is enough to identify NCR, so this reads both fields — a
  // payload carrying only the region name is still recognised.
  if (
    REGIONS_WITHOUT_PROVINCES.has(components.province) ||
    REGIONS_WITHOUT_PROVINCES.has(components.region)
  ) {
    components.province = null;
  }
  // A region the provider did not report is filled from a province it DID
  // report. That is a copy of a supplied value, not an inference — and it is why
  // the NCR correction above matters: for NCR there is no province left to copy,
  // so both stay null rather than one being invented from a region.
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
      //
      // This reads `municipalitySubdivision` — the field `parseComponents` just
      // refused to map to `barangay` — and that is not an inconsistency. A
      // district is a perfectly good answer to "where is this, roughly" and a
      // bad answer to "which barangay is this", so the same field serves here and
      // fails there. This string is never stored and never becomes a component.
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
