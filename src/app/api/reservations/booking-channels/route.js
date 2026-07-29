import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
export async function GET(req) { try { await requireAuth(req); const { rows } = await query(`SELECT * FROM booking_channels WHERE status = 'Active' ORDER BY channel_id ASC`); return ok(rows || []); } catch (e) { return handleError(e); } }
