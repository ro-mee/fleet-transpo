import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
export async function PUT(req, { params }) { try { await requirePermission(req, "ai", "update"); const id = (await params).id; await query(`UPDATE ai_insights SET status = 'Dismissed', is_read = true WHERE insight_id = $1`, [id]); return ok({ dismissed: true }); } catch (e) { return handleError(e); } }
