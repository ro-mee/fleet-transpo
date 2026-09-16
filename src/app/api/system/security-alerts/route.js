import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

// Admin visibility for security_alert audit rows (written by raiseSecurityAlert).
// PII is limited to employee_id + email — admins already see both in user
// management; no hashes, tokens, or OTP material ever enters these rows.
//
// NOTE: the PK is audit_logs.log_id (see supabase/migrations/001_schema.sql);
// it is aliased to `id` so the response keeps the { id, ... } contract.
export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const { rows } = await query(
      `SELECT a.log_id AS id, a.created_at, a.employee_id, e.email, a.new_values AS details, a.ip_address
         FROM audit_logs a
         LEFT JOIN employees e ON e.employee_id = a.employee_id
        WHERE a.action = 'security_alert' AND a.resource = 'authentication'
        ORDER BY a.log_id DESC
        LIMIT 50`
    );
    return ok({
      alerts: (rows || []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        employee_id: r.employee_id,
        email: r.email || null,
        type: r.details?.type || "unknown",
        details: r.details || {},
        ip_address: r.ip_address || null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
