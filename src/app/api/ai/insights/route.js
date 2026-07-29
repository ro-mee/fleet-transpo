import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try { await requireAuth(req); const { rows } = await query(`SELECT * FROM ai_insights WHERE status = 'Active' ORDER BY created_at DESC`); return ok(rows || []); } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO ai_insights (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
