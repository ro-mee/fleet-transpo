import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { attachVehicleDocument, signVehicleDocuments } from "@/lib/uploads/document-storage";
import { writeAuditRequired } from "@/lib/audit";

// Client-writable columns for vehicledocuments. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const DOC_WRITABLE = [
  "vehicle_id",
  "document_type",
  "document_number",
  "file_url",
  "expiry_date",
  "status",
];

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "vehicles", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    if (body.file_ref !== undefined) body.file_url = body.file_ref;
    if (body.upload_id && !body.file_url) return err("The uploaded file reference is required.", 400);
    const setClause = [];
    const values = [];
    for (const key of DOC_WRITABLE) {
      if (body[key] !== undefined) {
        setClause.push(`${key} = $${setClause.length + 1}`);
        values.push(body[key]);
      }
    }
    if (setClause.length === 0) return err("No valid fields provided", 400);
    values.push(id);
    const document = await withTransaction(async tx => {
      const { rows: beforeRows } = await tx.query(`SELECT *, expiry_date::text AS expiry_date FROM vehicledocuments WHERE document_id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const before = beforeRows[0];
      if (!before) return null;
      const kind = body.document_type || before.document_type;
      if (body.file_url !== undefined || body.vehicle_id !== undefined || body.document_type !== undefined) {
        const ref = await attachVehicleDocument(tx, session, { ...body, file_url: body.file_url === undefined ? before.file_url : body.file_url, document_type: kind }, body.vehicle_id || before.vehicle_id);
        if (body.file_url !== undefined) {
          const index = DOC_WRITABLE.filter(key => body[key] !== undefined).indexOf("file_url");
          values[index] = ref;
          body.file_url = ref;
        }
      }
      const changed = DOC_WRITABLE.some(key => body[key] !== undefined && String(body[key] ?? "") !== String(before[key] ?? ""));
      const clearReview = changed ? ", verification_status = 'Pending', verified_by = NULL, verified_at = NULL" : "";
      const { rows } = await tx.query(`UPDATE vehicledocuments SET ${setClause.join(", ")}${clearReview}, updated_at = NOW() WHERE document_id = $${values.length} AND deleted_at IS NULL RETURNING *`, values);
      await writeAuditRequired(tx, req, session, { action: "update", resource: "vehicledocuments", resourceId: Number(id), newValues: { changed_fields: DOC_WRITABLE.filter(key => body[key] !== undefined), verification_cleared: changed } });
      return rows[0];
    });
    if (!document) return err("Document not found", 404);
    return ok((await signVehicleDocuments([document]))[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requirePermission(req, "vehicles", "delete");
    const id = (await params).id;
    const { rowCount } = await query(
      `UPDATE vehicledocuments SET deleted_at = NOW(), status = 'Inactive' WHERE document_id = $1`,
      [id]
    );
    if (rowCount === 0) return err("Document not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
