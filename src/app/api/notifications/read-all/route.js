import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
export async function PUT(req) { try { await requireAuth(req); await query(`UPDATE notifications SET is_read = true, read_at = NOW() WHERE is_read = false`); return ok({ read: true }); } catch (e) { return handleError(e); } }
