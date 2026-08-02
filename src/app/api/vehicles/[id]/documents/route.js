import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

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
    const doc = { ...body, vehicle_id: +id };
    const keys = Object.keys(doc);
    const values = Object.values(doc);
    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO vehicledocuments (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
