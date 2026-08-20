import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

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
    await requireAuth(req);
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
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
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
    const { rows } = await query(
      `INSERT INTO vehicledocuments (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
