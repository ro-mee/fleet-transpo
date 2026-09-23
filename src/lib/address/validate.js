// Server-side address validation — the boundary that does not trust the client.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// ------------------------------------
// `verified: true` arriving from a browser is worthless. Anyone can POST it. So
// the server never reads that flag from the request: it re-resolves the place
// through the provider itself and treats ITS answer as authoritative. The
// client's job is to say "the operator picked this place id" — nothing more.
//
// That single decision closes the whole class of stale-pair bugs. There is no
// way to submit Address B with Address A's coordinates, because the coordinates
// are never taken from the request in the first place: they are looked up from
// the place id that goes with Address B. A mismatch between what the client
// claimed and what the provider says is treated as evidence of a stale pair and
// rejected, rather than silently reconciled in the client's favour.
//
// ENFORCEMENT MODES
// -----------------
// operational — a canonical location or the hotel base. These drive geofences,
//   ETAs and turn-by-turn navigation, so an unverified pin is a genuine
//   operational fault rather than a data-quality nicety: saving is refused.
// personal    — a driver's home or emergency-contact address. A geocoder that
//   does not know someone's barangay must never stop them being onboarded, so
//   these always save and are simply badged unverified.

import { haversineKm } from "@/lib/geo/distance";
import { emptyAddressValue, emptyComponents } from "./parse";
import { normalizePostalCode, postalCodeError } from "./postal";
import { addressGeocoder } from "./provider";

export const ADDRESS_MODE = Object.freeze({
  OPERATIONAL: "operational",
  PERSONAL: "personal",
});

/**
 * How far a client-reported coordinate may sit from the provider's own answer
 * before we call it a stale pair. 50 m is comfortably wider than coordinate
 * rounding differences and comfortably narrower than the distance between two
 * different addresses, which is the gap this has to separate.
 */
export const COORDINATE_MISMATCH_TOLERANCE_M = 50;

const COMPONENT_KEYS = Object.keys(emptyComponents());

/** Trim to a non-empty string, or null. The one coercion used throughout. */
function text(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A finite, in-range number, or null. */
function coordinate(value, limit) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

/**
 * Coerce arbitrary request JSON into a well-formed AddressValue.
 *
 * Every field is rebuilt from scratch rather than spread from the input, so an
 * unexpected key cannot ride along into a database write. Unknown properties are
 * dropped by omission, which is why this is an allowlist and not a merge.
 *
 * @param {unknown} input
 * @returns {object}
 */
export function normalizeAddressInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawComponents =
    source.components && typeof source.components === "object" && !Array.isArray(source.components)
      ? source.components
      : {};

  const components = emptyComponents();
  for (const key of COMPONENT_KEYS) components[key] = text(rawComponents[key]);

  const postalCode = normalizePostalCode(source.postalCode);
  const claimedSource = source.postalCodeSource === "provider" || source.postalCodeSource === "manual"
    ? source.postalCodeSource
    : null;

  return {
    raw: text(source.raw) || "",
    addressId: Number.isSafeInteger(Number(source.addressId)) ? Number(source.addressId) : null,
    formattedAddress: text(source.formattedAddress) || "",
    components,
    postalCode,
    postalCodeSource: postalCode ? (claimedSource ?? "manual") : null,
    latitude: coordinate(source.latitude, 90),
    longitude: coordinate(source.longitude, 180),
    // Deliberately NOT read from the input — see the header. It is recomputed
    // below and the caller gets whatever the server concluded.
    verified: false,
    provider: text(source.provider),
    providerPlaceId: text(source.providerPlaceId),
    verifiedAt: null,
  };
}

/**
 * Structural rules that hold whatever the provider says.
 *
 * Range is checked against the RAW submitted numbers, not the coerced ones.
 * `coordinate()` turns an out-of-range value into null, which would otherwise
 * make a bad coordinate indistinguishable from an absent one — and an absent
 * pair is a legitimate, savable state. The raw values are passed in explicitly
 * so this stays a pure function of its arguments.
 *
 * @param {object} value              a normalised AddressValue
 * @param {unknown} [rawLatitude]     the number as submitted
 * @param {unknown} [rawLongitude]
 * @returns {string|null} the error, or null
 */
export function structuralError(value, rawLatitude, rawLongitude) {
  const rawLat = Number(rawLatitude);
  const rawLng = Number(rawLongitude);
  const submittedLat = rawLatitude !== "" && rawLatitude !== null && rawLatitude !== undefined && Number.isFinite(rawLat);
  const submittedLng = rawLongitude !== "" && rawLongitude !== null && rawLongitude !== undefined && Number.isFinite(rawLng);

  if (submittedLat && Math.abs(rawLat) > 90) return "Latitude must be between -90 and 90.";
  if (submittedLng && Math.abs(rawLng) > 180) return "Longitude must be between -180 and 180.";

  // Half a coordinate is worse than none: it reads as "located" to every
  // downstream consumer while being unusable for navigation.
  const hasLat = value.latitude !== null || submittedLat;
  const hasLng = value.longitude !== null || submittedLng;
  if (hasLat !== hasLng) return "Latitude and longitude must be provided together.";

  if (value.postalCodeSource === "manual" && value.postalCode) {
    const error = postalCodeError(value.postalCode);
    if (error) return error;
  }
  return null;
}

/**
 * Resolve a submitted address into the authoritative value the server will
 * store, or an error.
 *
 * @param {unknown} input              the raw request field
 * @param {object} [opts]
 * @param {string} [opts.mode]         ADDRESS_MODE.OPERATIONAL | ADDRESS_MODE.PERSONAL
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 * @returns {Promise<{ ok: true, value: object } | { ok: false, error: string }>}
 */
export async function resolveAddress(input, opts = {}) {
  const mode = opts.mode === ADDRESS_MODE.OPERATIONAL ? ADDRESS_MODE.OPERATIONAL : ADDRESS_MODE.PERSONAL;
  const value = normalizeAddressInput(input);
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const structural = structuralError(value, raw.latitude, raw.longitude);
  if (structural) return { ok: false, error: structural };

  // Nothing to resolve — a blank optional address, which is a valid state.
  const isEmpty = !value.formattedAddress && !value.raw && !value.providerPlaceId;
  if (isEmpty) {
    if (mode === ADDRESS_MODE.OPERATIONAL) return { ok: false, error: "Address is required." };
    return { ok: true, value: emptyAddressValue() };
  }

  // ── The authoritative path ───────────────────────────────────────────────
  // A place id means the operator selected a real suggestion. Ask the provider
  // what it actually is; the request's own coordinates are never used.
  if (value.providerPlaceId) {
    const resolved = await addressGeocoder.geocode(value.providerPlaceId, {
      rawInput: value.raw,
      // @ts-expect-error — fetchImpl is an optional test seam
      fetchImpl: opts.fetchImpl,
    });

    if (resolved) {
      // The client's client-side postal code survives only if it was manual —
      // a typed ZIP is the operator's own assertion. A provider-sourced one is
      // replaced by the provider's current answer.
      const keepManualPostal =
        value.postalCodeSource === "manual" && value.postalCode ? value.postalCode : null;
      const merged = {
        ...resolved,
        raw: value.raw || resolved.raw,
        addressId: value.addressId,
        postalCode: keepManualPostal ?? resolved.postalCode,
        postalCodeSource: keepManualPostal ? "manual" : resolved.postalCodeSource,
        // A manual ZIP not backed by the provider is not proof of anything, but
        // it also does not undermine a verified POSITION — the two are separate
        // states, so verification stands on its own.
      };

      if (value.latitude !== null && value.longitude !== null) {
        const driftM =
          haversineKm(
            { lat: value.latitude, lng: value.longitude },
            { lat: merged.latitude, lng: merged.longitude }
          ) * 1000;
        if (Number.isFinite(driftM) && driftM > COORDINATE_MISMATCH_TOLERANCE_M) {
          return {
            ok: false,
            error:
              "These coordinates do not match the selected address. Re-select the location and try again.",
          };
        }
      }

      return { ok: true, value: merged };
    }

    // Provider could not resolve the id — an outage, or a place that has since
    // been removed. Operational saves stop here; a personal address degrades to
    // unverified text rather than losing what the operator typed.
    if (mode === ADDRESS_MODE.OPERATIONAL) {
      return {
        ok: false,
        error: "This address could not be verified with the mapping provider. Try again, or pick another location.",
      };
    }
  }

  // ── Unverified manual entry ──────────────────────────────────────────────
  const manual = {
    ...emptyAddressValue(value.raw || value.formattedAddress),
    addressId: value.addressId,
    formattedAddress: value.formattedAddress || value.raw,
    components: value.components,
    postalCode: value.postalCode,
    postalCodeSource: value.postalCode ? "manual" : null,
    latitude: value.latitude,
    longitude: value.longitude,
    provider: value.latitude !== null ? "manual" : null,
    verified: false,
    verifiedAt: null,
  };

  if (mode === ADDRESS_MODE.OPERATIONAL) {
    return {
      ok: false,
      error: "Coordinates must be verified before this location can be saved. Search for the address and select a result.",
    };
  }

  return { ok: true, value: manual };
}
