import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAuditRequired } from "@/lib/audit";

// Client-writable columns for vehicledocuments. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const DOC_WRITABLE = [
  "document_type",
  "document_number",
  "file_url",
  "expiry_date",
  "status",
];

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "vehicles", "read_all");
    const { id } = await params;
    const { rows } = await query(
      `SELECT * FROM vehicledocuments WHERE vehicle_id = $1 AND deleted_at IS NULL ORDER BY expiry_date ASC`,
      [id]
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "vehicles", "update");
    const { id } = await params;
    const body = await parseBody(req);
    const columns = [];
    const values = [];
    for (const key of DOC_WRITABLE) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    columns.push("vehicle_id");
    values.push(+id);
    const cols = columns.join(", ");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const row = await withTransaction(async (tx) => {
      const { rows } = await tx.query(`INSERT INTO vehicledocuments (${cols}) VALUES (${placeholders}) RETURNING *`, values);
      await writeAuditRequired(tx, req, session, {
        action: "create", resource: "vehicledocuments", resourceId: rows[0]?.document_id,
        newValues: { vehicle_id: Number(id), changed_fields: DOC_WRITABLE.filter((key) => body[key] !== undefined), outcome: "created" },
      });
      return rows[0];
    });
    return ok(row, 201);
  } catch (e) { return handleError(e); }
}
