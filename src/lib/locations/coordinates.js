// Coordinate precedence for the canonical-location save paths.
//
// WHAT WENT WRONG WITHOUT THIS
// ----------------------------
// Both `/api/locations` handlers resolved coordinates as
//
//     const latitudeInput = linkedCoordinates?.latitude ?? body.latitude;
//
// so a Google Maps link SILENTLY BEAT coordinates sent in the same request. The
// `??` reads like a fallback and is not one: it is a precedence, unstated, in
// favour of the paste. An operator who dropped a pin while a link sat in the
// field got the link's position, with no indication the pin was discarded — and
// the position is what the geofence is built on.
//
// WHAT REPLACES IT
// ----------------
// Explicit coordinates win, and the two sources are never silently reconciled:
//
//     pin only                -> pin          (unchanged)
//     link only, resolves     -> link         (unchanged)
//     link only, unresolved   -> error        (unchanged — same message)
//     neither                 -> error        (unchanged — same message)
//     both, same point        -> either       (indistinguishable)
//     both, different points  -> ERROR        <- the only behaviour change
//
// The disagreement is refused rather than resolved because the server cannot
// know which source the operator meant, and both guesses are wrong: take the
// link and a fresh pin is discarded; take the pin and a freshly pasted link does
// nothing. Refusing an ambiguity rather than guessing at it is the rule the rest
// of this feature already follows.
//
// AN UNRESOLVABLE LINK DOES NOT BLOCK A SAVE THAT CARRIES A PIN. The geocoder is
// a convenience, not a dependency — a dead provider must not make an operator's
// own coordinates unsaveable. That was already true of the old chain and is
// preserved here deliberately.
//
// WHY IT IS A MODULE. The POST and PUT handlers each carried their own copy of
// this logic, so "which source wins" was two independent answers that happened
// to agree. Now it is one function with one answer, and the routes are thin
// enough that they cannot disagree.

import { resolveGoogleMapsCoordinates } from "@/lib/google-maps";

/**
 * Two positions closer together than this are the same position.
 *
 * Both sides are rounded to 7 decimals before comparison, so this only absorbs
 * float noise, never real disagreement: 1e-7 degrees is about 1.1 cm, while two
 * entries for the same real place differ by metres.
 */
const SAME_POINT = 1e-7;

const UNRESOLVED_LINK =
  "This Google Maps link could not be resolved to coordinates. Use a dropped-pin link or enter the coordinates manually.";
const NO_COORDINATES = "Add a Google Maps link or enter both coordinates.";
const CONFLICT =
  "The Google Maps link and the coordinates entered name different points. Remove one, or correct it.";

/**
 * Decide where a location is being saved.
 *
 * Pure: the link's coordinates are passed in already resolved, so the precedence
 * rule can be tested without a network call or a vendor in the way.
 *
 * @param {object} [input]
 * @param {string|number} [input.latitude]    as sent by the client — a string, or absent
 * @param {string|number} [input.longitude]
 * @param {{latitude: number, longitude: number}|null} [input.linked]  resolved from maps_url
 * @param {boolean} [input.linkSupplied]  whether a maps_url was given at all, which
 *   a null `linked` cannot tell you: "no link" and "a link that did not resolve"
 *   are different mistakes and must not share a message.
 * @returns {{latitude: number, longitude: number}|{error: {maps_url: string}}}
 */
export function chooseLocationCoordinates({
  latitude,
  longitude,
  linked = null,
  linkSupplied = false,
} = {}) {
  // A HALF PAIR IS NOT A POSITION. One coordinate without the other describes
  // nothing, so it counts as absent and the link gets its turn — which is what
  // the old `??` chain did too. An out-of-range value is treated the same way,
  // for the same reason: it is not a position, so it cannot be preferred over
  // one. The form refuses both before they get here; this is the backstop.
  const pinLat = degrees(latitude, -90, 90);
  const pinLng = degrees(longitude, -180, 180);
  const pin = pinLat !== null && pinLng !== null ? { latitude: pinLat, longitude: pinLng } : null;

  if (pin && linked && !samePoint(pin, linked)) {
    return { error: { maps_url: CONFLICT } };
  }

  const chosen = pin ?? linked;

  if (!chosen) {
    return { error: { maps_url: linkSupplied ? UNRESOLVED_LINK : NO_COORDINATES } };
  }

  return { latitude: round7(chosen.latitude), longitude: round7(chosen.longitude) };
}

/**
 * The same rule, reading the request body and resolving the link.
 *
 * Split from `chooseLocationCoordinates` only so the decision above needs no
 * network. Callers use this one.
 *
 * @param {object} body  the parsed request body
 * @returns {Promise<{latitude: number, longitude: number}|{error: {maps_url: string}}>}
 */
export async function resolveCoordinates(body = {}) {
  const mapsUrl = String(body.maps_url || "").trim();
  // A blank link is not a link, and `linkSupplied` is what keeps "no link given"
  // and "a link that did not resolve" from sharing one message.
  const linked = mapsUrl ? await resolveGoogleMapsCoordinates(mapsUrl) : null;
  return chooseLocationCoordinates({
    latitude: body.latitude,
    longitude: body.longitude,
    linked,
    linkSupplied: Boolean(mapsUrl),
  });
}

/** A degrees value that is present and in range, or null. */
function degrees(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function samePoint(a, b) {
  return (
    Math.abs(round7(a.latitude) - round7(b.latitude)) <= SAME_POINT &&
    Math.abs(round7(a.longitude) - round7(b.longitude)) <= SAME_POINT
  );
}

/** The scale `addresses`/`locations` store: numeric(10,7). */
function round7(value) {
  return Number(Number(value).toFixed(7));
}
