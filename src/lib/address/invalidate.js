// The anti-stale rule, as a pure function.
//
// REQUIREMENT THIS EXISTS FOR
// ---------------------------
// "The system must NEVER submit Address B with Latitude A."
//
// The way that bug happens in practice is mundane: an operator picks an address,
// the pin and coordinates are filled in, and then they edit the street name
// without re-selecting. The coordinate still describes the OLD address, and
// nothing about the row looks wrong — it has text, a ZIP, a coordinate and a
// verified tick, all of them now describing two different places.
//
// The defence is that editing the text CLEARS the derived fields in the same
// operation that changes the text. There is no window in which the form holds
// new text and old coordinates, so no submit path can observe that state. This
// function is that operation, and every address field in the app routes its
// edits through it so there is exactly one definition of "what becomes stale".
//
// THE ONE EXEMPTION, AND WHY
// --------------------------
// A MANUALLY ENTERED postal code survives an edit; a PROVIDER-SOURCED one does
// not. The distinction is provenance, not convenience:
//
//   postalCodeSource === "provider"  This ZIP is a property of the address the
//                                    provider returned. Edit the address and it
//                                    describes the old place — stale, cleared.
//
//   postalCodeSource === "manual"    The operator asserted this ZIP themselves,
//                                    often precisely BECAUSE the provider had
//                                    none (a real and common case for Philippine
//                                    barangay addresses). It was never derived
//                                    from the provider's answer, so a change to
//                                    that answer cannot invalidate it. Discarding
//                                    it would destroy the only copy of a fact the
//                                    operator supplied by hand.
//
// It is kept, but it is no longer trustworthy — it may well describe the old
// address. So `postalCodeUnconfirmed` is set, and the UI must show it as amber
// and worded as an open question ("confirm ZIP for the new address") rather than
// as a settled value. Clearing it would lose data; showing it unchanged would
// assert something unproven. Neither is acceptable, so it is kept and flagged.

import { emptyAddressValue } from "./parse";

/** True when a value carries nothing an operator would recognise as an address. */
export function isBlankAddress(value) {
  if (!value) return true;
  // Trimmed, because a field holding only spaces is blank — treating it as
  // content would let a cleared address submit as a non-empty one.
  const raw = typeof value.raw === "string" ? value.raw.trim() : value.raw;
  return !raw && !value.formattedAddress && !value.providerPlaceId;
}

/**
 * The value to hold after the operator edits the text of an address.
 *
 * Everything the provider or a previous selection contributed is discarded:
 * the coordinates above all, but also the verified flag, the place id, the
 * resolved formatted address and every structured component. A component like
 * `barangay: "Deparo"` is just as much a property of the old address as
 * `latitude` is, and leaving it behind would let a stale barangay be submitted
 * alongside a new street.
 *
 * @param {object|null} previous  the current value, before the edit
 * @param {string} raw            the text as it now stands
 * @returns {object} a fresh, unverified value
 */
export function invalidateForInput(previous, raw) {
  // Only a hand-entered ZIP survives — see the header. `postalCodeSource` is
  // authoritative here rather than "is there a postal code", because a
  // provider-sourced ZIP is indistinguishable from a manual one by value alone.
  const retainedPostal =
    previous?.postalCodeSource === "manual" && previous.postalCode ? previous.postalCode : null;

  const next = emptyAddressValue(raw);
  next.postalCode = retainedPostal;
  next.postalCodeSource = retainedPostal ? "manual" : null;

  // Kept, but explicitly marked as no longer describing the current text. The
  // UI must render this as a question, never as a confirmed value.
  next.postalCodeUnconfirmed = Boolean(retainedPostal);

  return next;
}

/**
 * The value to hold once a fresh provider answer has been accepted for the
 * current text. Clears the "confirm this ZIP" flag, because the address it was
 * waiting on has now arrived.
 *
 * @param {object} resolved  a value returned by the server
 * @returns {object} the same value, with the transient flag cleared
 */
export function confirmResolved(resolved) {
  return { ...resolved, postalCodeUnconfirmed: false };
}
