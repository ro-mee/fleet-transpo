// Stored media references: the object KEY, not a URL.
//
// Every bucket holding personal media in this app is PRIVATE — driver licences,
// face captures, fuel receipts, incident evidence, expense receipts. A private
// object is reachable only through a signed URL, and a signed URL is a bearer
// credential with an expiry. So it has to be minted when it is needed and never
// written down.
//
// Storing the URL instead is what produced two findings:
//
//   SEC-UPLOAD-006  an /object/public/ URL minted with getPublicUrl(). On a
//                   private bucket that URL does not authorize at all, so the
//                   link is dead — and it is a public-style reference to a
//                   photograph of a government identity document.
//   SEC-UPLOAD-003  a createSignedUrl() minted at ten years and written into a
//                   durable column. A ten-year token has no revocation path;
//                   only rotating the storage key invalidates it.
//
// This module owns the read half of the fix: given whatever a column actually
// holds, produce a fresh short-lived URL. The write half is the caller storing
// the object key it just uploaded.
//
// SERVER-ONLY — createAdminClient() carries the service-role key.
//
// COMPATIBILITY, and why the key is recovered rather than the URL passed
// through. Columns written before this change hold URLs, and the approved
// remediation deliberately does not rewrite them (no production-data mutation).
// A legacy URL is not handed back on the strength of its host: a getPublicUrl()
// value has an allow-listed host, so a host check would wave it straight
// through — serving a dead image and perpetuating the public-style reference,
// which *is* SEC-UPLOAD-006. Instead the object key is recovered from the URL's
// own path, because both storage URL shapes encode it deterministically. That
// repairs those rows on read, defuses a legacy ten-year token at read time, and
// needs no migration.

import { createAdminClient } from "@/lib/supabase/admin";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import { isBase64DataUrl } from "@/lib/validation";
import {
  decodeSegment,
  parseStoredKey,
  isStoredObjectKey,
  KNOWN_MEDIA_BUCKETS,
} from "@/lib/storage/key-format";

/** One hour. The convention the expense and incident readers already use. */
export const DEFAULT_MEDIA_TTL_SECONDS = 60 * 60;

// The format itself lives in the leaf module `key-format` so that
// `lib/validation` can share one definition without importing this file (which
// imports validation). Re-exported here because callers resolving references
// should not have to reach past this module for them.
export { KNOWN_MEDIA_BUCKETS, isStoredObjectKey };

// Both shapes Supabase serves objects under. The trailing group is the object
// key, percent-encoded, once the bucket segment is removed.
const OBJECT_PATH = /^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/;

/**
 * A legacy signed URL carries its token in the query string. Never log it.
 */
function redact(ref) {
  if (typeof ref !== "string") return `<${typeof ref}>`;
  const cut = ref.indexOf("?");
  const head = cut === -1 ? ref : ref.slice(0, cut);
  return head.length > 120 ? `${head.slice(0, 120)}…` : head;
}

/**
 * Recover the object key from a legacy storage URL.
 *
 * Returns null when `ref` is not a storage URL for `bucket` — a host outside
 * the fleet allow-list, a bucket segment naming a different bucket, a different
 * URL shape, or any path segment that fails to decode safely.
 *
 * @param {string} ref    The stored value, expected to be an absolute URL.
 * @param {string} bucket The bucket the key must belong to.
 * @returns {string|null}  The object key, or null when not recoverable.
 */
export function objectKeyFromStorageUrl(ref, bucket) {
  if (typeof ref !== "string" || !ref || !bucket) return null;
  // Reuses the shared guard for scheme, embedded credentials and host, so this
  // cannot drift from the allow-list the CSP img-src is computed from.
  if (!isSafeRemoteMediaUrl(ref)) return null;
  let url;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  const match = OBJECT_PATH.exec(url.pathname);
  if (!match) return null;
  const [, bucketSegment, rawKey] = match;
  if (bucketSegment !== bucket) return null;
  const segments = rawKey.split("/").map(decodeSegment);
  if (segments.some((s) => s === null)) return null;
  return segments.join("/");
}

/**
 * True when `ref` is something `signedUrlFor` is meant to resolve: a stored
 * key, a legacy storage URL for one of `buckets`, or an inline data: image.
 *
 * Exists for the callers that legitimately also accept an ordinary external
 * URL — `employees.avatar_url` is the case in point. Those callers need to
 * decide whether to resolve at all; without this, every such value would fall
 * through to the "unresolvable" warning, and a legitimate value would become
 * log noise that hides the real misses.
 *
 * @param {string|string[]} buckets One bucket, or candidates to try.
 */
export function isResolvableMediaRef(ref, buckets) {
  if (typeof ref !== "string" || !ref) return false;
  if (ref.startsWith("data:")) return true;
  if (isStoredObjectKey(ref)) return true;
  const candidates = (Array.isArray(buckets) ? buckets : [buckets]).filter((b) =>
    KNOWN_MEDIA_BUCKETS.has(b)
  );
  return candidates.some((candidate) => objectKeyFromStorageUrl(ref, candidate) !== null);
}

async function signKey(bucket, key, expiresIn) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn(
      `object-refs: could not sign "${bucket}/${key}": ${error?.message || "no signedUrl returned"}`
    );
    return null;
  }
  return data.signedUrl;
}

/**
 * Resolve one stored reference to a fresh short-lived signed URL.
 *
 * - a bucket-qualified key               -> signed against its own prefix
 * - a bare object key                    -> signed against `bucket`
 * - a legacy storage URL (both shapes)   -> key recovered, then signed
 * - a strict base64 data: image          -> passed through (already validated on
 *                                           write by isAllowedStoredImageRef,
 *                                           and it never touches the network)
 * - anything else                        -> null, and reported
 *
 * The last case never passes the value through and is never silently dropped.
 * Passing it through is SEC-UPLOAD-006 (a getPublicUrl value has an allow-listed
 * host, so a host check waves it through); dropping it silently would read as
 * "nothing was stored here" when the truth is "this could not be read".
 *
 * @param {string|string[]} bucket One bucket, or candidates to try when the
 *   column can hold more than one bucket's objects (`employees.avatar_url`).
 * @returns {Promise<string|null>}
 */
export async function signedUrlFor(bucket, ref, { expiresIn = DEFAULT_MEDIA_TTL_SECONDS } = {}) {
  const candidates = (Array.isArray(bucket) ? bucket : [bucket]).filter((b) =>
    KNOWN_MEDIA_BUCKETS.has(b)
  );
  if (typeof ref !== "string" || !ref || candidates.length === 0) return null;

  if (ref.startsWith("data:")) {
    // isSafeRemoteMediaUrl alone returns true for any `data:image/` prefix
    // (remote-url.js:34), which would admit `data:image/svg+xml,<svg …>` and
    // every malformed payload with it. Stored inline images are always real
    // base64, so hold them to the strict check.
    return isBase64DataUrl(ref) ? ref : null;
  }

  const parsed = parseStoredKey(ref);
  if (parsed) {
    // A qualified prefix is authoritative — it is read from the value itself,
    // not assumed from the column.
    return signKey(parsed.bucket || candidates[0], parsed.key, expiresIn);
  }

  // A legacy URL names its own bucket in the path, so the candidate that
  // matches is the right one; there is nothing to guess at even when the column
  // is ambiguous.
  for (const candidate of candidates) {
    const key = objectKeyFromStorageUrl(ref, candidate);
    if (key) return signKey(candidate, key, expiresIn);
  }

  console.warn(
    `object-refs: unresolvable stored reference in "${candidates.join("|")}": ${redact(ref)}`
  );
  return null;
}

/**
 * Array form, for columns that hold a list of references (incident photos).
 * Unresolvable entries are dropped, matching signedUrlFor's fail-closed rule.
 *
 * @returns {Promise<string[]>}
 */
export async function signRefs(bucket, refs, { expiresIn = DEFAULT_MEDIA_TTL_SECONDS } = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const urls = [];
  for (const ref of refs) {
    const url = await signedUrlFor(bucket, ref, { expiresIn });
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Reduce an accepted media value to the form that gets STORED: a
 * bucket-qualified object key.
 *
 * This exists because readers sign, and clients echo back what they were shown.
 * The admin driver form seeds its field from the loaded driver and submits it
 * unchanged on any unrelated save (`drivers/[id]/edit/page.js:116,295`), so
 * without this step every save would persist whichever short-lived URL the
 * reader just minted — and the image would rot when that URL expired. That is
 * the same class of defect as the findings this module exists to fix, so the
 * invariant is enforced here rather than trusted to each client.
 *
 * Accepts, and returns:
 *   - a strict base64 data: image -> unchanged (already validated on write, and
 *                                   it carries no expiry to go stale)
 *   - a key, bare or qualified    -> requalified
 *   - a storage URL, either shape -> its key, recovered from the path
 *   - anything else               -> null; the caller keeps the stored value
 *
 * The written form is always bucket-qualified (`driver-licenses/12/uuid.jpg`),
 * so a value copied between columns stays resolvable — `employees.avatar_url`
 * receives both face-capture and licence keys and cannot infer its bucket.
 *
 * @returns {string|null}
 */
export function canonicalStoredRef(ref, bucket) {
  if (typeof ref !== "string" || !ref || !KNOWN_MEDIA_BUCKETS.has(bucket)) return null;
  if (ref.startsWith("data:")) return isBase64DataUrl(ref) ? ref : null;

  const parsed = parseStoredKey(ref);
  if (parsed) return `${parsed.bucket || bucket}/${parsed.key}`;

  // A storage URL names its own bucket in the path, and that beats the column's
  // default: `employees.avatar_url` is copied from `license_image_url`, so a
  // value can legitimately arrive at a column whose bucket is not its own.
  for (const candidate of KNOWN_MEDIA_BUCKETS) {
    const key = objectKeyFromStorageUrl(ref, candidate);
    if (key) return `${candidate}/${key}`;
  }
  return null;
}
