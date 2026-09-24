// Pulling a PICKED address out of a request body, once, for every route that
// accepts one.
//
// WHY THIS IS A FUNCTION AND NOT THREE INLINE BLOCKS
// --------------------------------------------------
// The block is short — read the field, resolve it, turn a refusal into field
// errors — and it was written inline at `api/locations/route.js` and again at
// `api/locations/[id]/route.js`. Two copies of a four-line rule is a reasonable
// thing to leave alone. The driver surface then needed it FOUR more times (a
// residential and an emergency-contact address, each on POST and PUT), and six
// copies of a rule is where one of them quietly stops matching the others. This
// is the same point at which `src/lib/locations/coordinates.js` was extracted.
//
// It does not re-implement any rule. Everything that decides whether a pick is
// acceptable lives in `validate-structured.js`, which in turn delegates the
// completeness rule to `structured.js`. This file decides WHERE the value is,
// and what SHAPE a refusal takes.
//
// THE SHAPE OF A REFUSAL IS THE ONE THING IT ADDS
// -----------------------------------------------
// `resolveStructuredAddress` reports its errors keyed by the FORM field that is
// wrong — `streetRoad`, `postalCode`, `barangay`. That is unambiguous when a
// request carries exactly one address, which is every caller before this one.
// A driver carries two: an error keyed `streetRoad` cannot say whether it means
// the driver's own address or their next-of-kin's, and the response carries the
// whole object. So the keys are namespaced with the field the pick arrived in —
// `structured_address.streetRoad`, `emergency_structured_address.postalCode` —
// and the first one is what `errValidation` surfaces as the message, so nothing
// an operator reads changes.
//
// ABSENT IS NOT EMPTY
// -------------------
// A missing field resolves to `{ ok: true, value: null }`, meaning "no pick
// arrived", which the caller reads as an instruction to leave the stored address
// and its registry row alone. That is the documented rule the locations PUT
// depends on to survive a rename: `locations/[id]/route.js` treats a supplied
// empty string as an error precisely so it can never be confused with an
// omission. Nothing here changes that — an empty string IS supplied, and is
// resolved (and refused) like any other malformed pick.

import { resolveStructuredAddress } from "./validate-structured";

/**
 * Resolve the picked address carried in `body[field]`.
 *
 * @param {unknown} body  the parsed request body
 * @param {string} [field]  which field to read; the driver surface passes two
 * @returns {Promise<
 *   { ok: true, value: object|null } |
 *   { ok: false, errors: Record<string,string> }
 * >} `value` is the server-resolved AddressValue, or null when nothing was sent.
 */
export async function resolvePickedAddress(body, field = "structured_address") {
  // A body that cannot carry a field carries no pick. The route's own schema
  // validation is what reports a body of the wrong shape; reporting it here as
  // well would give one malformed request two different first errors.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true, value: null };
  }

  const raw = body[field];
  if (raw === undefined || raw === null) return { ok: true, value: null };

  const resolved = await resolveStructuredAddress(raw);
  if (resolved.ok) return { ok: true, value: resolved.value };

  const detail = resolved.errors;
  if (detail && Object.keys(detail).length > 0) {
    return {
      ok: false,
      errors: Object.fromEntries(
        Object.entries(detail).map(([key, message]) => [`${field}.${key}`, message])
      ),
    };
  }

  // The pin rules return a bare `error` with no field detail, because "latitude
  // and longitude must be provided together" belongs to the pair rather than to
  // either one of them. It is about the address as a whole, so it is keyed as
  // the address as a whole.
  return { ok: false, errors: { [field]: resolved.error } };
}
