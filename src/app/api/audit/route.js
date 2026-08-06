import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

/**
 * GET /api/audit
 *
 * System administration audit trail. Reads the write-only audit_logs table
 * (populated by src/lib/audit.js from the write routes) and renders it for the
 * System Console. Restricted to system_admin — it exposes old/new values and
 * the actor on every tracked mutation.
 *
 * Query params: action, resource, from, to, limit (max 500), offset.
 */
export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin"]);
    const sp = new URL(req.url).searchParams;
    const params = [];
    let idx = 1;
    const conditions = [];

    const action = sp.get("action");
    if (action) { conditions.push(`action = $${idx++}`); params.push(action); }

    const resource = sp.get("resource");
    if (resource) { conditions.push(`resource = $${idx++}`); params.push(resource); }

    const from = sp.get("from");
    if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }

    const to = sp.get("to");
    if (to) { conditions.push(`created_at <= $${idx++}`); params.push(to); }

    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "200", 10) || 200, 1), 500);
    const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);

    let sql = `SELECT a.log_id, a.employee_id, e.first_name, e.last_name, e.email,
                      a.action, a.resource, a.resource_id, a.old_values, a.new_values,
                      a.ip_address, a.created_at
                 FROM audit_logs a
                 LEFT JOIN employees e ON e.employee_id = a.employee_id`;
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += ` ORDER BY a.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM audit_logs a ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""}`,
      params.slice(0, idx - 3)
    );

    return ok({ logs: rows, total: countRows[0]?.total ?? 0, limit, offset });
  } catch (e) { return handleError(e); }
}
