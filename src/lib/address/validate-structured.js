// Server-side validation for a PICKED address — the cascade path.
//
// WHY THIS IS A SIBLING OF `validate.js` RATHER THAN PART OF IT
// -------------------------------------------------------------
// `validate.js` exists to enforce one rule: never believe `verified: true` from a
// browser, re-resolve through the provider, and take ITS answer. Everything in it
// is about a geocoder being the source of truth.
//
// This file has no provider in it at all. Here the source of truth is the PSGC
// hierarchy, and the rule is the same shape applied to a different authority: the
// server resolves the chosen barangay code against its own tables and derives
// region, province and city FROM THAT, rather than accepting the text the client
// sent alongside it.
//
// Merging them would mean one function with two mutually exclusive notions of
// "authoritative", which is how the wrong branch gets taken later. They share the
// pure pieces — `postal.js`, `structured.js`, `parse.js` — and nothing else.
//
// WHAT THE CLIENT'S GEOGRAPHY IS USED FOR: NOTHING
// ------------------------------------------------
// The client sends `regionName`, `provinceName`, `cityName` and `barangayName`.
// All four are DISCARDED. Not compared, not reconciled — discarded, and replaced
// with the values derived from the code.
//
// Rejecting on mismatch was the first design and it is worse in both directions.
// It cannot catch anything that ignoring does not already catch (the stored
// values are the derived ones either way), and it fails spuriously on innocent
// input: a barangay renamed by plebiscite years after an address was saved would
// make that address permanently unsavable, when the server already knows the
// correct new name. Deriving is the same rule `validate.js` applies to
// coordinates — the client states an intent, the server decides what it means.
//
// WHAT IS STILL REFUSED
// ---------------------
//   * An unknown or missing barangay code. There is nothing to derive from.
//   * Missing street-level detail (house number, street, ZIP) — via
//     `detailErrors`, the same rule the form's Save button uses.
//   * A malformed ZIP, or half a coordinate.
//
// AND WHAT IS NEVER CLAIMED
// -------------------------
// `verified` is false and `provider` is 'manual'. A pin the operator dropped is
// their claim about where a door is; it is not a provider verification and this
// function does not pretend otherwise. Nothing here sets `verified: true`, so a
// picked address can never present itself as geocoder-confirmed. The database
// column already anticipates `provider = 'manual'`.

import { resolveBarangayChain } from "@/lib/geo/psgc";
import { emptyAddressValue, emptyComponents } from "./parse";
import { normalizePostalCode, postalCodeError } from "./postal";
import {
  ADDRESS_TYPE_VALUES,
  composeStructuredLines,
  detailErrors,
  structuredErrors,
} from "./structured";

const DEFAULT_ADDRESS_TYPE = "home";

/** Matches the varchar limits in the migration. */
const LIMITS = {
  houseBuildingNumber: 50,
  streetRoad: 200,
  unitFloorBuilding: 120,
  subdivisionVillage: 120,
  landmark: 255,
  additionalDetails: 500,
};

/** Trim to a non-empty string, or null. Collapses internal whitespace. */
function text(value, limit) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  // Truncate rather than reject: the input already carries maxLength, so a value
  // arriving longer was not typed by a person, and silently trimming is safer
  // than a database error on a length the operator cannot see.
  return trimmed.slice(0, limit);
}

/** A finite, in-range coordinate, or null. */
function coordinate(value, limit) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

/**
 * Coerce arbitrary request JSON into the structured form's value shape.
 *
 * Rebuilt from scratch rather than spread, so an unexpected key cannot ride
 * along into a database write. An allowlist, not a merge — the same discipline
 * `normalizeAddressInput` in `validate.js` uses.
 *
 * Note what is absent: `regionName`, `provinceName`, `cityName`, `barangayName`
 * are not read here at all. See the header.
 *
 * @param {unknown} input
 * @returns {object}
 */
export function normalizeStructuredInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const type = text(source.type, 16);
  const postalCode = normalizePostalCode(source.postalCode);

  return {
    type: ADDRESS_TYPE_VALUES.includes(type) ? type : DEFAULT_ADDRESS_TYPE,

    // The one geographic value the client is believed about — and only as a
    // CHOICE, never as a description. Everything else about the location is
    // derived from it below.
    psgcBarangayCode: text(source.psgcBarangayCode, 10),

    houseBuildingNumber: text(source.houseBuildingNumber, LIMITS.houseBuildingNumber) ?? "",
    streetRoad: text(source.streetRoad, LIMITS.streetRoad) ?? "",
    unitFloorBuilding: text(source.unitFloorBuilding, LIMITS.unitFloorBuilding) ?? "",
    subdivisionVillage: text(source.subdivisionVillage, LIMITS.subdivisionVillage) ?? "",
    landmark: text(source.landmark, LIMITS.landmark),
    additionalDetails: text(source.additionalDetails, LIMITS.additionalDetails),

    postalCode,
    latitude: coordinate(source.latitude, 90),
    longitude: coordinate(source.longitude, 180),
  };
}

/**
 * Resolve a picked address into the row the server will store, or an error.
 *
 * @param {unknown} input
 * @param {object} [opts]
 * @param {(code: string) => Promise<object|null>} [opts.resolve]  injectable for tests
 * @returns {Promise<{ ok: true, value: object } | { ok: false, error: string, errors?: object }>}
 */
export async function resolveStructuredAddress(input, opts = {}) {
  const resolve = opts.resolve ?? resolveBarangayChain;
  const value = normalizeStructuredInput(input);

  // ── Stage 1: the street-level detail ──────────────────────────────────────
  // Checked before any lookup, because it needs no database and a request with
  // no house number should not cost a query.
  const detail = detailErrors(value);
  if (Object.keys(detail).length > 0) {
    return { ok: false, error: Object.values(detail)[0], errors: detail };
  }

  // ── Stage 2: the leaf must exist ──────────────────────────────────────────
  if (!value.psgcBarangayCode) {
    return { ok: false, error: "Select a barangay.", errors: { barangay: "Select a barangay." } };
  }

  const chain = await resolve(value.psgcBarangayCode);
  if (!chain) {
    // Distinct from a malformed request: the code is well-formed but the
    // geography does not contain it. Saying so beats "invalid address", which
    // would send the operator looking for a typo they did not make.
    return {
      ok: false,
      error:
        "That barangay is not in the address database. Pick it again, or ask an administrator to run the PSGC import.",
      errors: { barangay: "Unknown barangay code." },
    };
  }

  // ── Stage 3: everything geographic is now DERIVED, not accepted ───────────
  const derived = {
    ...value,
    regionCode: chain.region.code,
    regionName: chain.region.name,
    // `null` here is a real answer, not a miss: Metro Manila has no provinces.
    provinceCode: chain.province?.code ?? null,
    provinceName: chain.province?.name ?? null,
    cityCode: chain.city.code,
    cityName: chain.city.name,
    barangayCode: chain.barangay.code,
    barangayName: chain.barangay.name,
    cityHasNoProvince: !chain.province,
  };

  // The SAME completeness rule the form's Save button applies, now with the
  // province requirement answered by the data instead of guessed.
  const errors = structuredErrors(derived, { requiresProvince: Boolean(chain.province) });
  if (Object.keys(errors).length > 0) {
    return { ok: false, error: Object.values(errors)[0], errors };
  }

  // ── Stage 4: the pin ──────────────────────────────────────────────────────
  // Half a coordinate is worse than none — it reads as "located" to every
  // downstream consumer while being unusable. The CHECK constraint enforces the
  // same pairing, and this turns it into a message instead of a 500.
  const rawLat = Number(input?.latitude);
  const rawLng = Number(input?.longitude);
  const submittedLat = Number.isFinite(rawLat) && input?.latitude !== "" && input?.latitude != null;
  const submittedLng = Number.isFinite(rawLng) && input?.longitude !== "" && input?.longitude != null;
  if (submittedLat !== submittedLng) {
    return { ok: false, error: "Latitude and longitude must be provided together." };
  }
  if (submittedLat && Math.abs(rawLat) > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (submittedLng && Math.abs(rawLng) > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }

  // The ZIP is the operator's own assertion here — no provider supplied it — so
  // it is recorded as 'manual', which is what makes it survive a later change
  // that would have replaced a provider-sourced one.
  if (value.postalCode) {
    const zipError = postalCodeError(value.postalCode);
    if (zipError) return { ok: false, error: zipError, errors: { postalCode: zipError } };
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  // `formatted_address` is built from the DERIVED geography and the submitted
  // street detail, by the same function the preview on screen calls — so the
  // stored string is exactly what the operator was shown.
  const formattedAddress = composeStructuredLines(derived).join(", ");

  const components = emptyComponents();
  components.houseNumber = value.houseBuildingNumber || null;
  components.unitNumber = value.unitFloorBuilding || null;
  components.street = value.streetRoad || null;
  components.subdivision = value.subdivisionVillage || null;
  components.barangay = chain.barangay.name;
  components.city = chain.city.name;
  components.province = chain.province?.name ?? null;
  components.region = chain.region.name;
  components.country = "Philippines";

  return {
    ok: true,
    value: {
      ...emptyAddressValue(value.streetRoad),
      formattedAddress,
      components,
      postalCode: value.postalCode,
      postalCodeSource: value.postalCode ? "manual" : null,
      latitude: value.latitude,
      longitude: value.longitude,
      // Never true on this path. A dropped pin is a claim, not a verification —
      // see the header. Nothing downstream may read this as "the provider
      // confirmed this address exists here".
      verified: false,
      provider: "manual",
      providerPlaceId: null,
      verifiedAt: null,

      // The fields `addresses` carries beyond AddressValue.
      addressType: derived.type,
      landmark: value.landmark,
      additionalDetails: value.additionalDetails,
      psgcBarangayCode: chain.barangay.code,
    },
  };
}
