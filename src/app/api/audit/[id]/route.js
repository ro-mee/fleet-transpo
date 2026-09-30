import { query, withTransaction } from "@/lib/db";
import { requireAuth, requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { sanitizeAuditValues, writeAuditRequired, writeAudit } from "@/lib/audit";

function safePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const json = sanitizeAuditValues(value);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export async function GET(req, { params }) {
  let session = null;
  try {
    session = await requirePermission(req, "audit", "read");
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) return err("Invalid audit log ID", 400);

    const { rows } = await query(
      `SELECT a.log_id, a.employee_id, e.first_name, e.last_name, e.email,
              a.action, a.resource, a.resource_id, a.old_values, a.new_values,
              a.ip_address, a.created_at
         FROM audit_logs a
         LEFT JOIN employees e ON e.employee_id = a.employee_id
        WHERE a.log_id = $1
        LIMIT 1`,
      [id]
    );
    const log = rows[0];
    if (!log) return err("Audit log entry not found", 404);

    await withTransaction((tx) => writeAuditRequired(tx, req, session, {
      action: "audit_detail_viewed",
      resource: "audit_logs",
      resourceId: id,
      newValues: { scope: "detail" },
    }));

    return ok({
      ...log,
      old_values: safePayload(log.old_values),
      new_values: safePayload(log.new_values),
      payload_redacted: true,
    });
  } catch (e) {
    if (e?.status === 403) {
      const deniedSession = session || await requireAuth(req, ["*"]).catch(() => null);
      if (deniedSession) {
        await writeAudit(req, deniedSession, {
          action: "sensitive_access_denied",
          resource: "audit_logs",
          newValues: { reason_code: "permission_denied", scope: "detail" },
        });
      }
    }
    return handleError(e);
  }
}
