import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";

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
    await requirePermission(req, "vehicles", "update");
    const id = (await params).id;
    const body = await parseBody(req);
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
    const { rows } = await query(
      `UPDATE vehicledocuments SET ${setClause.join(", ")} WHERE document_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return err("Document not found", 404);
    return ok(rows[0]);
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
