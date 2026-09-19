// Sign the media references on a driver-shaped row for the response.
//
// The columns this reads hold object keys now (SEC-UPLOAD-006 / SEC-UPLOAD-003),
// and a key is not renderable — the UI binds these straight to an `<img src>`.
// So every route that serializes a driver resolves them here, at the API
// boundary, which is what keeps the browser components unchanged: they still
// receive a URL, it is just one that expires.
//
// Signing in the response rather than in each component also means there is one
// place to audit for "did we forget to re-sign this column on some path".
//
// The write side must NOT store what this returns. `canonicalStoredRef`
// (`lib/storage/object-refs`) reduces an echoed URL back to its key on the way
// in, because the admin driver form submits back whatever it was shown.

import { signedUrlFor, canonicalStoredRef } from "@/lib/storage/object-refs";

const FACE_BUCKET = "face-captures";
const LICENCE_BUCKET = "driver-licenses";

// `employees.avatar_url` is the one column whose bucket cannot be assumed: the
// face-photo route writes a face-capture into it, and the licence mirror copies
// `license_image_url` into it (`api/drivers/route.js`, `api/drivers/[id]`). New
// writes are bucket-qualified so the value resolves from its own prefix; these
// candidates are for legacy bare keys and legacy URLs. Exported because
// `lib/auth.js` resolves the same two columns onto the session cookie and must
// not drift from this list.
export const AVATAR_BUCKETS = [FACE_BUCKET, LICENCE_BUCKET];

/**
 * Reduce a submitted media field to the form that gets stored.
 *
 * `undefined` means "the caller did not send this field" and must stay
 * undefined so a partial update does not clear it. An empty value clears it.
 *
 * The `?? value` fallback covers a value `mediaUrl` accepts but no bucket owns —
 * an image on the app's own origin, say. Those are left exactly as they were
 * rather than being dropped, which is the behaviour that existed before this
 * change; canonicalising is a tightening, not a new restriction.
 *
 * @returns {string|null|undefined}
 */
export function toStoredMediaRef(value, bucket) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return canonicalStoredRef(value, bucket) ?? value;
}

/**
 * Assign a resolved URL, leaving an absent field absent.
 *
 * A missing key and a null one are different things in a JSON response, and
 * adding `license_image_url: null` to a row that never had the column would
 * change payloads that nothing asked to change.
 */
async function assign(target, key, bucket) {
  if (target[key] === undefined) return;
  target[key] = await signedUrlFor(bucket, target[key]);
}

/**
 * Resolve every driver media reference to a fresh short-lived URL.
 *
 * Handles the row's own columns plus the two nested spots that carry an avatar
 * (`employees.avatar_url` from the joined employee, and `account.avatar_url` on
 * the detail payload). Returns a copy; the input is not mutated.
 *
 * @param {object} row A driver-shaped payload.
 * @returns {Promise<object>}
 */
export async function signDriverMedia(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };

  await Promise.all([
    assign(out, "face_image_url", FACE_BUCKET),
    assign(out, "license_image_url", LICENCE_BUCKET),
    assign(out, "license_back_image_url", LICENCE_BUCKET),
    assign(out, "avatar_url", AVATAR_BUCKETS),
  ]);

  for (const nested of ["employees", "account"]) {
    if (out[nested] && typeof out[nested] === "object") {
      out[nested] = { ...out[nested] };
      await assign(out[nested], "avatar_url", AVATAR_BUCKETS);
    }
  }

  return out;
}

/**
 * Array form for list endpoints.
 *
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
export async function signDriverMediaList(rows) {
  if (!Array.isArray(rows)) return rows;
  return Promise.all(rows.map((row) => signDriverMedia(row)));
}
