import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

/**
 * GET /api/system/activity
 *
 * Lightweight platform-health read for the System Console. Aggregates the
 * recent integration and automation activity (the closest thing this system
 * has to an API/system-health feed) plus a few headline counters. Restricted to
 * system_admin.
 *
 * Response:
 *   recent    — last 20 entries (integration_log + automation_logs), newest first
 *   counters  — integration ok / failed counts (last 24h), automation ok/failed
 */
export async function GET(req) {
  try {
    await requirePermission(req, "audit", "read");

    const { rows: integration } = await query(
      `SELECT 'integration' AS source, log_id AS id, direction AS type, source_system AS detail,
              status, error_message, created_at
         FROM integration_log
        ORDER BY created_at DESC LIMIT 12`
    );

    const { rows: automation } = await query(
      `SELECT 'automation' AS source, log_id AS id, trigger_event AS type, reference_type AS detail,
              status, NULL AS error_message, executed_at AS created_at
         FROM automation_logs
        ORDER BY executed_at DESC LIMIT 8`
    );

    const { rows: counters } = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM integration_log WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours') AS integration_failed,
        (SELECT COUNT(*)::int FROM integration_log WHERE status = 'processed' AND created_at >= NOW() - INTERVAL '24 hours') AS integration_ok,
        (SELECT COUNT(*)::int FROM automation_logs WHERE status = 'failed' AND executed_at >= NOW() - INTERVAL '24 hours') AS automation_failed,
        (SELECT COUNT(*)::int FROM automation_logs WHERE status = 'success' AND executed_at >= NOW() - INTERVAL '24 hours') AS automation_ok,
        (SELECT COUNT(*)::int FROM notifications WHERE created_at >= NOW() - INTERVAL '24 hours') AS notifications_24h`
    );

    const recent = [...integration, ...automation]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return ok({ recent, counters: counters[0] });
  } catch (e) { return handleError(e); }
}
