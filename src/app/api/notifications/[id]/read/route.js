import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
export async function PUT(req, { params }) { try { await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]); const id = (await params).id; await query(`UPDATE notifications SET is_read = true, read_at = NOW() WHERE notification_id = $1`, [id]); return ok({ read: true }); } catch (e) { return handleError(e); } }
