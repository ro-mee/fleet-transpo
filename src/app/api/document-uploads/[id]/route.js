import { requireAuth, requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { UPLOAD_UUID } from "@/lib/uploads/document-policy";
import { cleanupDocumentDrafts, DOCUMENT_UPLOAD_ROLES } from "@/lib/uploads/document-storage";

export async function DELETE(req, { params }) {
  try {
    const session = await requireAuth(req, DOCUMENT_UPLOAD_ROLES);
    const id = (await params).id;
    if (!UPLOAD_UUID.test(id)) return err("Invalid upload ID.", 400);
    const row = (await query(`SELECT * FROM document_uploads WHERE upload_id = $1 AND owner_id = $2`, [id, session.user.employeeId])).rows[0];
    if (!row) return ok({ cancelled: true }); // Also safe before the upload row exists.
    await requirePermission(req, row.resource, row.target_id ? "update" : "create");
    if (row.state === "attached") return err("This file is already saved. Replace it through the record form.", 409);
    const cancelled = await query(`UPDATE document_uploads SET state = 'cancelled' WHERE upload_id = $1 AND owner_id = $2 AND state IN ('uploading','ready') RETURNING upload_id`, [id, session.user.employeeId]);
    if (!cancelled.rows[0] && row.state !== "cancelled" && row.state !== "deleted") return err("This file changed while cancelling. Reload the record to confirm its status.", 409);
    const result = await cleanupDocumentDrafts({ uploadId: id, ownerId: session.user.employeeId });
    return ok({ cancelled: true, cleanup_pending: result.pending > 0 });
  } catch (e) { return handleError(e); }
}
