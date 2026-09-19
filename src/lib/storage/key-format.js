// The stored media reference format, and nothing else.
//
// A leaf module by design: it imports nothing, so both sides of the reference
// contract can share one definition without a cycle. `lib/validation` needs it
// to accept a key as a storable image value, and `lib/storage/object-refs`
// needs it to tell a key from a legacy URL — and object-refs already imports
// from validation, so the format could not live in either one.
//
// The format
// ----------
// A stored reference is a bucket-qualified object key:
//
//     driver-licenses/12/6f1c….jpg
//     face-captures/12/9ab3….png
//
// Never a URL: no scheme, no host, no query, no token, no expiry. That is the
// whole point — a signed URL is a bearer credential, and one written into a
// column cannot be revoked. See `lib/storage/object-refs` for the read half.
//
// A BARE key ("12/6f1c….jpg") is also accepted, because a column that can only
// hold one bucket's objects does not need the prefix and older readers may pass
// one. `employees.avatar_url` is the reason qualifications exist at all: it
// receives both face-capture and licence keys, so a bare key there would be
// genuinely ambiguous.

/**
 * The private buckets a stored reference may name. `vehicle-images` is
 * deliberately absent: it is public by design (migration 050) and its objects
 * are read by URL, not signed.
 */
export const KNOWN_MEDIA_BUCKETS = new Set([
  "driver-licenses",
  "face-captures",
  "fuel-receipts",
  "incident-evidence",
  "expense-receipts",
]);

// Keys this app mints are shallow: "<driverId>/<uuid>.<ext>" or
// "<driverId>/<folder>/<uuid>.<ext>". A generous ceiling, not a policy.
const MAX_KEY_SEGMENTS = 8;

// The characters a key segment may contain.
//
// Every producer in this repo builds a key from digits, a uuid, a validated
// extension and occasionally a folder slug (`4/9f1c….png`, `4/abc-123/receipt.png`),
// so this charset covers all of them with room to spare.
//
// It is also load-bearing, and the reason it is a whitelist rather than the
// handful of "..", "/" and "\" checks it replaced. Without a charset, a value
// with no scheme separator is a single well-formed segment, so `javascript:alert(1)`
// parsed as a perfectly good bare object key — and `isAllowedStoredImageRef`
// then accepted it as a storable image reference. That is the shape of input a
// media column is most likely to be attacked with, so it must not be a key.
const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Decode one path segment, rejecting anything that could escape its bucket.
 *
 * Decoding is the point — the key is percent-encoded inside a legacy URL — so
 * the containment checks below are what keep it safe. Decoding a path and *then*
 * matching it is the bug documented in isOwnedFuelImageUrl
 * (`lib/fuel/receipt-storage.js:65-73`); that code compared a decoded path
 * against an encoded prefix and so matched things the real path never had.
 *
 * @returns {string|null} The decoded segment, or null when it cannot be trusted.
 */
export function decodeSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null; // malformed escape sequence
  }
  // The charset check subsumes the separator checks it replaced: "/" and "\"
  // both fail it.
  if (!KEY_SEGMENT.test(decoded)) return null;
  // It does NOT subsume the dot-segment check — "." is in the charset so that
  // extensions parse, which leaves ".." a legal segment. A segment that is only
  // dots is a relative-path traversal, not a filename.
  if (/^\.+$/.test(decoded)) return null;
  return decoded;
}

/**
 * Split a stored key into its optional bucket prefix and the key itself.
 *
 * The `decoded === segment` test rejects anything percent-escaped. Keys this app
 * mints are `<digits>/<uuid>.<ext>` and never contain an escape, so a value that
 * does is not one of ours — fail closed rather than guess at it.
 *
 * @returns {{bucket: string|null, key: string}|null}
 */
export function parseStoredKey(ref) {
  if (typeof ref !== "string" || !ref) return null;
  if (ref.startsWith("data:")) return null;
  if (ref.includes("://")) return null;
  if (ref.startsWith("/")) return null;
  const segments = ref.split("/");
  if (segments.length === 0 || segments.length > MAX_KEY_SEGMENTS) return null;
  if (!segments.every((segment) => decodeSegment(segment) === segment)) return null;
  if (KNOWN_MEDIA_BUCKETS.has(segments[0])) {
    const key = segments.slice(1).join("/");
    return key ? { bucket: segments[0], key } : null;
  }
  return { bucket: null, key: ref };
}

/**
 * True when `ref` is a bucket object key rather than a URL — bare or
 * bucket-qualified.
 */
export function isStoredObjectKey(ref) {
  return parseStoredKey(ref) !== null;
}
