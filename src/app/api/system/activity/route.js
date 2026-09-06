import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { CRON_HEARTBEAT_KEY } from "@/lib/system-health";

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
        (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'error' AND reviewed_at IS NULL) AS push_failed,
        (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'pending') AS push_pending,
        (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'login_failure' AND created_at >= NOW() - INTERVAL '24 hours') AS login_failed_24h`
    );

    // 1. Live 30-day usage series from real database tables
    const { rows: usage } = await query(`
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      ),
      b AS (
        SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count
        FROM transportation_requests
        WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY 1
      ),
      t AS (
        SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count
        FROM trips
        WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY 1
      ),
      m AS (
        SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count
        FROM vehiclemaintenance
        WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY 1
      ),
      l AS (
        SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count
        FROM audit_logs
        WHERE action = 'login_success' AND created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY 1
      )
      SELECT
        to_char(d.day, 'Mon FMDD') AS date,
        COALESCE(b.count, 0) AS bookings,
        COALESCE(t.count, 0) AS trips,
        COALESCE(m.count, 0) AS maintenance,
        COALESCE(l.count, 0) AS logins
      FROM days d
      LEFT JOIN b ON b.day = d.day
      LEFT JOIN t ON t.day = d.day
      LEFT JOIN m ON m.day = d.day
      LEFT JOIN l ON l.day = d.day
      ORDER BY d.day ASC
    `);

    // 2. Real Subsystem Telemetry & Explainable Health Metrics (No arbitrary formulas)
    const dbPingStart = Date.now();
    await query("SELECT 1");
    const dbLatencyMs = Date.now() - dbPingStart;

    const { rows: intTotals } = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'processed')::int AS processed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours')::int AS failed_24h
      FROM integration_log
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const intRow = intTotals[0] || {};
    const intTotal = intRow.total || 0;
    const apiRate = intTotal > 0 ? (((intRow.processed) / intTotal) * 100).toFixed(1) + "%" : "100.0%";

    const { rows: pushTotals } = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'error' AND reviewed_at IS NULL)::int AS error,
        COUNT(*) FILTER (WHERE status = 'error' AND reviewed_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours')::int AS error_24h
      FROM push_outbox
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const pushRow = pushTotals[0] || {};
    const pushTotal = pushRow.total || 0;
    const pushRate = pushTotal > 0 ? (((pushRow.sent) / pushTotal) * 100).toFixed(1) + "%" : "100.0%";

    const { rows: errorCategoryCounts } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE source = 'server' OR status_code >= 500)::int AS server_errors,
        COUNT(*) FILTER (WHERE (source = 'server' OR status_code >= 500) AND created_at >= NOW() - INTERVAL '24 hours')::int AS server_errors_24h,
        COUNT(*) FILTER (WHERE message ILIKE '%database%' OR message ILIKE '%connection%')::int AS db_errors,
        COUNT(*) FILTER (WHERE message ILIKE '%storage%' OR message ILIKE '%upload%')::int AS storage_errors,
        COUNT(*) FILTER (WHERE message ILIKE '%tomtom%' OR message ILIKE '%routing%' OR message ILIKE '%maps%')::int AS map_errors
      FROM app_errors
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const errCats = errorCategoryCounts[0] || {};

    const { rows: heartbeatRows } = await query(`
      SELECT setting_value, updated_at,
             EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS seconds_ago
      FROM system_settings
      WHERE setting_key = $1
    `, [CRON_HEARTBEAT_KEY]);
    const heartbeat = heartbeatRows[0];
    const cronIsRecent = heartbeat && heartbeat.seconds_ago <= 86400; // within 24h

    const loginFailures24h = Number(counters[0]?.login_failed_24h || 0);

    const services = [
      {
        name: "Web Application",
        status: (errCats.server_errors_24h || 0) > 0 ? "Degraded" : "Operational",
        uptime: (errCats.server_errors_24h || 0) > 0 ? `${errCats.server_errors_24h} err` : "0 err",
      },
      {
        name: "Database (Supabase)",
        status: dbLatencyMs > 400 || (errCats.db_errors || 0) > 0 ? "Degraded" : "Operational",
        uptime: `${dbLatencyMs}ms`,
      },
      {
        name: "API Integrations",
        status: (intRow.failed_24h || 0) > 0 ? "Degraded" : "Operational",
        uptime: apiRate,
      },
      {
        name: "File Storage",
        status: (errCats.storage_errors || 0) > 0 ? "Degraded" : "Operational",
        uptime: (errCats.storage_errors || 0) > 0 ? "Degraded" : "Healthy",
      },
      {
        name: "Push Notifications",
        status: (pushRow.error_24h || 0) > 0 || (pushRow.error || 0) > 0 ? "Degraded" : "Operational",
        uptime: pushRate,
      },
      {
        name: "Auth & Security",
        status: loginFailures24h >= 5 ? "Attention" : "Operational",
        uptime: loginFailures24h > 0 ? `${loginFailures24h} alert` : "0 alerts",
      },
      {
        name: "Scheduled Sync (Cron)",
        status: cronIsRecent ? "Operational" : heartbeat ? "Attention" : "Inactive",
        uptime: cronIsRecent ? "Active" : heartbeat ? "Stale" : "No run",
      },
    ];

    // 3. Real Operational Activities from audit_logs
    const { rows: activities } = await query(`
      SELECT a.log_id AS id,
             to_char(a.created_at AT TIME ZONE 'Asia/Manila', 'FMHH12:MI AM') AS time,
             COALESCE(NULLIF(TRIM(e.first_name || ' ' || e.last_name), ''), e.email, 'System') AS user,
             SUBSTRING(COALESCE(e.first_name, 'S'), 1, 1) || SUBSTRING(COALESCE(e.last_name, 'Y'), 1, 1) AS initials,
             CASE
               WHEN a.action LIKE '%login%' THEN 'Auth'
               WHEN a.action LIKE '%create%' THEN 'Created'
               WHEN a.action LIKE '%update%' THEN 'Updated'
               WHEN a.action LIKE '%delete%' THEN 'Deleted'
               ELSE 'Action'
             END AS action,
             CASE
               WHEN a.action LIKE '%login%' THEN 'blue'
               WHEN a.action LIKE '%create%' THEN 'teal'
               WHEN a.action LIKE '%update%' THEN 'green'
               ELSE 'purple'
             END AS "actionTone",
             INITCAP(REPLACE(a.resource, '_', ' ')) AS module,
             a.action || ' on ' || a.resource || COALESCE(' #' || a.resource_id, '') AS details
        FROM audit_logs a
        LEFT JOIN employees e ON e.employee_id = a.employee_id
       ORDER BY a.created_at DESC
       LIMIT 6
    `);

    // 4. Real Push Delivery Errors from push_outbox (unreviewed only —
    // reviewed rows are acknowledged history, see POST ../health/push-review)
    const { rows: pushErrors } = await query(`
      SELECT id, title, error, created_at
      FROM push_outbox
      WHERE status = 'error' AND reviewed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 4
    `);

    const recent = [...integration]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return ok({
      recent,
      counters: counters[0],
      usage: usage || [],
      services,
      activities: activities || [],
      pushErrors: pushErrors || [],
    });
  } catch (e) { return handleError(e); }
}
