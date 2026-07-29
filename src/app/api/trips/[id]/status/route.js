import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
export async function PUT(req, { params }) { try { await requireAuth(req); const id = (await params).id; const body = await parseBody(req); const { rows } = await query(`UPDATE trips SET trip_status = $1 WHERE trip_id = $2 RETURNING *`, [body.status, id]); if (!rows[0]) return err("Trip not found", 404); return ok(rows[0]); } catch (e) { return handleError(e); } }
