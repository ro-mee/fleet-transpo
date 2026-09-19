import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";
import { validateImage } from "@/lib/uploads/validator";
import { signedUrlFor, canonicalStoredRef } from "@/lib/storage/object-refs";
import { parseStoredKey } from "@/lib/storage/key-format";

const FUEL_RECEIPT_BUCKET = "fuel-receipts";

/**
 * One hour.
 *
 * This used to be ten years, because the URL was what got PERSISTED — the staff
 * review screen binds `receipt_url` straight to an `<img src>` days after
 * upload, so a short-lived URL would have rotted in the column. The column now
 * holds the object KEY and the readers sign per view (SEC-UPLOAD-003), so the
 * URL handed back here only has to outlive the upload -> scan -> submit
 * sequence it is passed through, which is seconds.
 */
export const FUEL_RECEIPT_TTL_SECONDS = 60 * 60;

export async function storeFuelReceipt(file, driverId, folder = "") {
  if (!file || typeof file === "string") {
    throw new Error("A valid receipt image file is required.");
  }

  const fileBuffer = await file.arrayBuffer();
  const validation = validateImage(file, new Uint8Array(fileBuffer));

  if (validation.error) {
    throw new Error(validation.error);
  }

  const contentType = validation.contentType;
  // The extension comes from the validated format, never from the client name:
  // `receipt.html` declared as image/png used to be stored as <uuid>.html with
  // Content-Type image/png, which is the exact disagreement a content sniffer
  // is built to resolve — and it is a stored-XSS shape wherever the object is
  // served from a host that honours the extension.
  const safeFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  const fileName = [driverId, safeFolder, `${uuidv4()}.${validation.extension}`].filter(Boolean).join("/");
  const supabase = createAdminClient();

  const { error: uploadError } = await supabase.storage
    .from(FUEL_RECEIPT_BUCKET)
    .upload(fileName, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("Supabase fuel receipt upload error:", uploadError);
    throw new Error("Failed to upload receipt image.");
  }

  // The KEY is what belongs in a column; the URL is what belongs in a response.
  // `receiptPath` is persisted, `receiptUrl` is what the client previews and
  // sends to the scan endpoint. Bucket-qualified so the value stays resolvable
  // wherever it is copied to.
  const receiptPath = canonicalStoredRef(fileName, FUEL_RECEIPT_BUCKET) || fileName;
  const receiptUrl = await signedUrlFor(FUEL_RECEIPT_BUCKET, receiptPath, {
    expiresIn: FUEL_RECEIPT_TTL_SECONDS,
  });

  if (!receiptUrl) {
    console.error("Supabase fuel receipt signed URL error: no signed URL returned");
    throw new Error("Failed to create a secure receipt URL.");
  }

  return {
    fileBuffer,
    contentType,
    receiptPath,
    receiptUrl,
  };
}

/**
 * Reduce an accepted fuel image reference to the form that gets STORED: a
 * bucket-qualified object key.
 *
 * The client is handed a short-lived URL at upload and echoes it back on
 * submit, so without this the column would keep receiving a URL — and now one
 * that expires within the hour, which is the same defect at a shorter clock.
 * Returns null when the value is not a resolvable fuel-receipts reference, and
 * the caller must then fail closed rather than store it.
 *
 * @returns {string|null}
 */
export function toStoredReceiptRef(value) {
  return canonicalStoredRef(value, FUEL_RECEIPT_BUCKET);
}

/**
 * Resolve an already ownership-checked reference to something fetchable.
 *
 * The scan endpoints `fetch()` the value the client sent. A key is not
 * fetchable — it has to be signed first, by us, rather than trusting the client
 * to hand over something already signed.
 *
 * @returns {Promise<string|null>} null when it cannot be resolved; fail closed.
 */
export async function resolveFuelImageUrl(ref) {
  return signedUrlFor(FUEL_RECEIPT_BUCKET, ref);
}

/**
 * Sign the media references on a fuel-shaped row for the response.
 *
 * Covers `receipt_url` (fuelrecords) and `gauge_photo_url` (fuelrequests) —
 * both hold object keys now. A reference that cannot be resolved becomes null
 * rather than being passed through: a dead link served as if it were fine is
 * the SEC-UPLOAD-006 shape.
 *
 * @returns {Promise<object>} a copy; the input is not mutated.
 */
export async function signFuelReceipt(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const column of ["receipt_url", "gauge_photo_url"]) {
    if (out[column] !== undefined) {
      out[column] = await signedUrlFor(FUEL_RECEIPT_BUCKET, out[column]);
    }
  }
  return out;
}

/** Array form for list endpoints. @returns {Promise<object[]>} */
export async function signFuelReceiptList(rows) {
  if (!Array.isArray(rows)) return rows;
  return Promise.all(rows.map((row) => signFuelReceipt(row)));
}

export function isOwnedFuelReceiptUrl(value, driverId) {
  return isOwnedFuelImageUrl(value, driverId);
}

/**
 * Does this reference belong to `driverId`'s own folder?
 *
 * Two shapes are accepted, and they are checked against the SAME expected
 * prefix so they cannot disagree about ownership:
 *
 *   - an object KEY (`fuel-receipts/4/uuid.png`, or the bare `4/uuid.png`) —
 *     what the upload route hands the client now, and what it may echo back;
 *   - a storage URL with a token — what an already-installed client sends, kept
 *     working so the fix does not require an app update to land first.
 *
 * A key is not a URL and is not fetchable on its own, so accepting one here is
 * not a loosening: the value still has to be signed by us before anything reads
 * it, and the path prefix still confines it to the driver's own folder.
 */
export function isOwnedFuelImageUrl(value, driverId, folder = "") {
  const expected = [
    ...String(driverId ?? "").split("/").filter(Boolean),
    ...String(folder || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean),
  ];
  if (expected.length === 0) return false;

  const parsed = parseStoredKey(value);
  if (parsed) {
    if (parsed.bucket && parsed.bucket !== FUEL_RECEIPT_BUCKET) return false;
    const segments = parsed.key.split("/");
    // Strictly longer: a key that IS the folder is not a file inside it.
    return segments.length > expected.length
      && expected.every((segment, i) => segments[i] === segment);
  }

  try {
    const url = new URL(value);
    const storageUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const safeFolder = String(folder || "").replace(/^\/+|\/+$/g, "");

    // The expected path is built segment by segment, each percent-encoded the way
    // the URL would carry it, and then compared as a raw PREFIX.
    //
    // Two things had to change. `includes` accepted any path that merely
    // contained the folder somewhere later on, so `/…/sign/other-bucket/storage/
    // v1/object/sign/fuel-receipts/4/x.png` satisfied it. And decoding the path
    // before matching let an encoded separator (`fuel-receipts%2F4%2F`) decode
    // INTO a match the real path never had. Both let a caller name an object
    // that is not in this driver's folder.
    const segments = [
      "storage", "v1", "object", "sign", FUEL_RECEIPT_BUCKET,
      ...String(driverId ?? "").split("/").filter(Boolean).map(encodeURIComponent),
      ...safeFolder.split("/").filter(Boolean).map(encodeURIComponent),
    ];
    return url.host === storageUrl.host
      && url.pathname.startsWith(`/${segments.join("/")}/`)
      && Boolean(url.searchParams.get("token"));
  } catch {
    return false;
  }
}
