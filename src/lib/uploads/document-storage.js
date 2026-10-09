import { query, withTransaction } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalStoredRef, signedUrlFor } from "@/lib/storage/object-refs";
import { DOCUMENT_KINDS, UPLOAD_UUID } from "./document-policy";
import { rolesFor } from "@/lib/auth/permissions";

export const DOCUMENT_UPLOAD_ROLES = [...new Set(["drivers", "vehicles"].flatMap(resource =>
  ["create", "update"].flatMap(action => rolesFor(resource, action))))];

export function publicUpload(row) {
  return { upload_id: row.upload_id, kind: row.kind, file_name: row.file_name,
    content_type: row.content_type, size_bytes: row.size_bytes, state: row.state,
    created_at: row.created_at, expires_at: row.expires_at, attached_at: row.attached_at };
}

export async function uploadResponse(row) {
  const ref = `${row.bucket}/${row.object_key}`;
  const preview = await signedUrlFor(row.bucket, ref);
  if (!preview) throw new AuthError("File stored, but its preview could not be prepared. Retry the upload.", 503);
  return { ...publicUpload(row), stored_ref: ref, preview_url: preview };
}

// Called INSIDE the record save transaction. Cancelling/expiring and attaching
// serialize on the same row lock, so cleanup can never delete an attached file.
export async function attachDocumentUpload(tx, session, { uploadId, kind, recordId, ref }) {
  const policy = DOCUMENT_KINDS[kind];
  const canonical = ref ? canonicalStoredRef(ref, policy.bucket) || ref : ref;
  if (!uploadId) {
    // New draft refs cannot bypass ownership checks by omitting the upload ID.
    if (typeof canonical === "string" && /^(driver-licenses|vehicle-documents)\/drafts\//.test(canonical)) {
      if (!canonical.startsWith(`${policy.bucket}/drafts/`)) throw new AuthError("This document belongs to a different document section.", 403);
      const { rows } = await tx.query(`SELECT upload_id FROM document_uploads
        WHERE bucket = $1 AND object_key = $2 AND resource = $3 AND kind = $4
          AND attached_record_id = $5 AND state = 'attached' FOR UPDATE`,
      [policy.bucket, canonical.slice(policy.bucket.length + 1), policy.resource, kind, Number(recordId)]);
      if (!rows[0]) throw new AuthError("This document is not attached to this record. Upload it again.", 403);
    }
    return canonical;
  }
  if (!UPLOAD_UUID.test(uploadId)) throw new AuthError("Invalid document upload ID.", 400);
  const { rows } = await tx.query(`SELECT * FROM document_uploads WHERE upload_id = $1 FOR UPDATE`, [uploadId]);
  const row = rows[0];
  if (!row || row.owner_id !== session.user.employeeId || row.resource !== policy.resource || row.kind !== kind
    || (row.target_id != null && Number(row.target_id) !== Number(recordId))) {
    throw new AuthError("This upload does not belong to this record or your session.", 403);
  }
  if (canonical !== `${row.bucket}/${row.object_key}`) throw new AuthError("The selected document does not match its upload.", 400);
  if (row.state === "attached" && Number(row.attached_record_id) === Number(recordId)) return `${row.bucket}/${row.object_key}`;
  if (row.state !== "ready" || new Date(row.expires_at).valueOf() <= Date.now()) {
    throw new AuthError("This upload was cancelled or expired. Upload the file again before saving.", 409);
  }
  await tx.query(`UPDATE document_uploads SET state = 'attached', attached_record_id = $2, attached_at = NOW()
    WHERE upload_id = $1`, [uploadId, Number(recordId)]);
  return `${row.bucket}/${row.object_key}`;
}

export async function attachVehicleDocument(tx, session, doc, recordId) {
  const ref = doc.file_ref || doc.file_url;
  if (!["OR_CR", "Insurance"].includes(doc.document_type)) {
    const canonical = canonicalStoredRef(ref, "vehicle-documents");
    if (doc.upload_id || /^(driver-licenses|vehicle-documents)\/drafts\//.test(canonical || "")) throw new AuthError("Choose OR/CR or Insurance for this document upload.", 400);
    return ref;
  }
  return attachDocumentUpload(tx, session, { uploadId: doc.upload_id, kind: doc.document_type, recordId, ref });
}

export async function documentMetadata(resource, recordId) {
  const { rows } = await query(`SELECT * FROM document_uploads
    WHERE resource = $1 AND attached_record_id = $2 AND state = 'attached' ORDER BY attached_at DESC`, [resource, Number(recordId)]);
  return rows;
}

export async function signVehicleDocuments(documents) {
  return Promise.all(documents.map(async (doc) => {
    const ref = canonicalStoredRef(doc.file_url, "vehicle-documents");
    return ref?.startsWith("vehicle-documents/") ? { ...doc, file_url: await signedUrlFor("vehicle-documents", ref), file_ref: ref } : doc;
  }));
}

// Bounded scheduled cleanup; no existing or attached object is ever selected.
export async function cleanupDocumentDrafts({ limit = 10, uploadId, ownerId } = {}) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(`SELECT * FROM document_uploads
      WHERE ((state = 'cancelled' AND ($1::uuid IS NOT NULL OR expires_at < NOW()))
        OR (state IN ('uploading', 'ready') AND expires_at < NOW()))
        AND ($1::uuid IS NULL OR upload_id = $1) AND ($2::integer IS NULL OR owner_id = $2)
      ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED`, [uploadId || null, ownerId || null, limit]);
    let deleted = 0;
    for (const row of rows) {
      const { error } = await createAdminClient().storage.from(row.bucket).remove([row.object_key]);
      if (error) continue;
      // A transfer can finish after its cancellation request. Keep its tombstone
      // until expiry so the scheduled pass removes any object written late.
      if (new Date(row.expires_at).valueOf() <= Date.now()) {
        await tx.query(`UPDATE document_uploads SET state = 'deleted' WHERE upload_id = $1`, [row.upload_id]);
      }
      deleted++;
    }
    return { deleted, pending: rows.length - deleted };
  });
}
