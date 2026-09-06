import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

/**
 * GET /api/system/activity
 *
 * Lightweight platform-health read for the System Console. Aggregates the
 * recent integration activity (the closest thing this system has to an
 * API/system-health feed) plus a few headline counters. Restricted to
 * system_admin.
 *
 * NOTE: an earlier version of this route also read `automation_logs`, but
 * that table was deliberately dropped by migration 005 (`DROP automation
 * tables`) and nothing recreates or writes to it — querying it 500s every
 * request and permanently breaks the Platform activity panel. Do not
 * re-add automation reads without a migration that recreates the table
 * and a writer that populates it.
 *
 * Response:
 *   recent    — last 20 integration_log entries, newest first
 *   counters  — integration ok / failed counts (last 24h),
 *               push outbox failed/pending, failed web+mobile logins (last 24h)
 */
export async function GET(req) {
  try {
    await requirePermission(req, "audit", "read");

    const { rows: integration } = await query(
      `SELECT 'integration' AS source, log_id AS id, direction AS type, source_system AS detail,
              status, error_message, created_at
         FROM integration_log
        ORDER BY created_at DESC LIMIT 20`
    );

    const { rows: counters } = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM integration_log WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours') AS integration_failed,
        (SELECT COUNT(*)::int FROM integration_log WHERE status = 'processed' AND created_at >= NOW() - INTERVAL '24 hours') AS integration_ok,
        (SELECT COUNT(*)::int FROM notifications WHERE created_at >= NOW() - INTERVAL '24 hours') AS notifications_24h,
        (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'error') AS push_failed,
        (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'pending') AS push_pending,
        (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'login_failure' AND created_at >= NOW() - INTERVAL '24 hours') AS login_failed_24h`
    );

    const recent = [...integration]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return ok({ recent, counters: counters[0] });
  } catch (e) { return handleError(e); }
}
