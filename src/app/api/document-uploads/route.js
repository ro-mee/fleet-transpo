import { createHash } from "node:crypto";
import { requireAuth, requirePermission, AuthError, ok, err, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { DOCUMENT_KINDS, UPLOAD_UUID, validateDocumentFile } from "@/lib/uploads/document-policy";
import { uploadResponse, cleanupDocumentDrafts, DOCUMENT_UPLOAD_ROLES } from "@/lib/uploads/document-storage";

// Read a bounded multipart body, including when Content-Length is missing.
async function readForm(req) {
  const ceiling = 10 * 1024 * 1024 + 65536;
  if (!req.body || Number(req.headers.get("content-length")) > ceiling) throw new AuthError("Upload is too large.", 413);
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ceiling) { await reader.cancel(); throw new AuthError("Upload is too large.", 413); }
      chunks.push(Buffer.from(value));
    }
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers.get("content-type") || "" } }).formData();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("Choose a valid file to upload.", 400);
  } finally { reader.releaseLock(); }
}

export async function POST(req) {
  try {
    const identity = await requireAuth(req, DOCUMENT_UPLOAD_ROLES);
    const throttle = await rateLimit(`document-upload:${identity.user.employeeId}`, { limit: 30, windowMs: 60000 });
    if (!throttle.allowed) return err("Too many uploads. Wait a minute and try again.", 429);
    const form = await readForm(req);
    const kind = form.get("kind");
    const policy = Object.hasOwn(DOCUMENT_KINDS, kind) ? DOCUMENT_KINDS[kind] : null;
    if (!policy) return err("Choose a supported document section.", 400);
    const targetValue = form.get("target_id");
    const targetId = targetValue ? Number(targetValue) : null;
    if (targetId != null && (!Number.isSafeInteger(targetId) || targetId < 1)) return err("Invalid record ID.", 400);
    const session = await requirePermission(req, policy.resource, targetId ? "update" : "create");
    const uploadId = form.get("upload_id");
    if (typeof uploadId !== "string" || !UPLOAD_UUID.test(uploadId)) return err("Invalid upload ID.", 400);
    const file = form.get("file");
    if (form.getAll("file").length !== 1 || !file || typeof file === "string") return err("Choose one file for this section.", 400);
    const preliminary = validateDocumentFile(file, kind);
    if (preliminary.error) return err(preliminary.error, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = validateDocumentFile(file, kind, bytes);
    if (valid.error) return err(valid.error, 400);
    if (targetId) {
      const sql = policy.resource === "drivers" ? `SELECT driver_id FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL` : `SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`;
      if (!(await query(sql, [targetId])).rows[0]) return err("Record not found.", 404);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `drafts/${session.user.employeeId}/${uploadId}.${valid.extension}`;
    const filename = file.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 255) || `scan.${valid.extension}`;
    const { rows } = await query(`INSERT INTO document_uploads
      (upload_id, owner_id, resource, kind, target_id, bucket, object_key, file_name, content_type, size_bytes, sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (upload_id) DO NOTHING RETURNING *`,
    [uploadId, session.user.employeeId, policy.resource, kind, targetId, policy.bucket, objectKey, filename, valid.contentType, file.size, hash]);
    if (!rows[0]) {
      const row = (await query(`SELECT * FROM document_uploads WHERE upload_id = $1`, [uploadId])).rows[0];
      if (!row || row.owner_id !== session.user.employeeId || row.sha256 !== hash || row.kind !== kind || row.target_id !== targetId) return err("This upload ID is already in use.", 409);
      if ((row.state === "ready" && new Date(row.expires_at) > new Date()) || row.state === "attached") return ok(await uploadResponse(row));
      return err("This upload is unfinished or expired. Choose the file again.", 409);
    }
    const storage = createAdminClient().storage.from(policy.bucket);
    const { error } = await storage.upload(objectKey, bytes, { contentType: valid.contentType, upsert: false });
    if (error || req.signal.aborted) {
      await query(`UPDATE document_uploads SET state = 'cancelled' WHERE upload_id = $1 AND state = 'uploading'`, [uploadId]);
      await cleanupDocumentDrafts({ uploadId, ownerId: session.user.employeeId });
      return err(error ? "File could not be stored. Retry the upload." : "Upload cancelled.", error ? 503 : 409);
    }
    const result = await query(`UPDATE document_uploads SET state = 'ready' WHERE upload_id = $1 AND state = 'uploading' RETURNING *`, [uploadId]);
    if (!result.rows[0]) {
      await cleanupDocumentDrafts({ uploadId, ownerId: session.user.employeeId });
      return err("Upload cancelled.", 409);
    }
    return ok(await uploadResponse(result.rows[0]), 201);
  } catch (e) { return handleError(e); }
}
