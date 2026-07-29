import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
export async function GET(req, { params }) { try { await requireAuth(req); const id = (await params).id; const { rows } = await query(`SELECT * FROM gpstracking WHERE trip_id = $1 ORDER BY recorded_at ASC`, [id]); return ok(rows); } catch (e) { return handleError(e); } }
