// Philippine postal code (ZIP) validation — pure, no I/O.
//
// Kept deliberately separate from location verification, because the two are
// independent facts about an address. A geocoder can confirm a place exists and
// return no postal code at all; a person can assert a ZIP the provider never
// gave us. `✓ Location verified` and `⚠ ZIP code not provided` are a normal,
// expected pair, so nothing here is allowed to conflate the two.
//
// Philippine ZIP codes are four digits (1000–9999 in practice). This module
// validates format only. Locality comparisons live in postal-reference.js and
// use the incomplete PHLPost directory with an explicit unknown outcome.

const PH_POSTAL_CODE_PATTERN = /^\d{4}$/;

/**
 * Trim a postal code for storage. Returns null when there is nothing usable, so
 * callers get a single falsy value to branch on rather than "" in some places
 * and null in others.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizePostalCode(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * True when the value is a well-formed Philippine postal code.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPhPostalCode(value) {
  const normalized = normalizePostalCode(value);
  return normalized !== null && PH_POSTAL_CODE_PATTERN.test(normalized);
}

/**
 * The validation message for a postal code, or null when it is acceptable.
 * Empty is acceptable — a missing ZIP is a state we display, not an error.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function postalCodeError(value) {
  const normalized = normalizePostalCode(value);
  if (normalized === null) return null;
  return isPhPostalCode(normalized)
    ? null
    : "ZIP code must be 4 digits (e.g. 1421).";
}
