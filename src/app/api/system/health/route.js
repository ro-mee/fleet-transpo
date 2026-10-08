import { query, getAdminClient } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import {
  buildHealthRows,
  CRON_HEARTBEAT_KEY,
  getHealthTelemetry,
  recordHealthSnapshot,
} from "@/lib/system-health";
import { getServerKey, fetchTomTomRoute } from "@/lib/tomtom";

/**
 * GET /api/system/health
 *
 * Detection surface for System Health & Reliability (owns detection + remediation
 * ROUTING; each specialized module owns its fix). Restricted to audit-read.
 *
 * Supports optional ?timeframe=24h (default), 7d, or 30d for time-series charts.
 *
 * Response: { rows, overall, checked_at, timeframe, kpis, charts, incidents }
 */
async function probe(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function GET(req) {
  try {
    await requirePermission(req, "audit", "read");
    const now = Date.now();
    const { searchParams } = new URL(req.url);
    const rawTf = searchParams.get("timeframe") || "24h";
    const timeframe = ["24h", "7d", "30d"].includes(rawTf) ? rawTf : "24h";

    const [appErrors15m, db, integration, push, ai, auth, sync, storage, maps] =
      await Promise.all([
        probe(async () =>
          (
            await query(
              `SELECT COUNT(*)::int AS n FROM app_errors WHERE created_at >= NOW() - INTERVAL '15 minutes'`
            )
          ).rows[0]?.n ?? 0
        ),
        probe(
          async () => {
            const started = Date.now();
            await query("SELECT 1");
            return { ok: true, latencyMs: Date.now() - started };
          },
          { ok: false }
        ),
        probe(async () => {
          const { rows } = await query(
            `SELECT
               (SELECT COUNT(*)::int FROM integration_log WHERE direction = 'outbound' AND status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours') AS failed,
               (SELECT COUNT(*)::int FROM integration_log WHERE direction = 'outbound' AND status = 'pending' AND created_at >= NOW() - INTERVAL '24 hours') AS pending`
          );
          const { rows: sample } = await query(
            `SELECT log_id, event_type, error_message, created_at
               FROM integration_log
              WHERE direction = 'outbound' AND status = 'failed'
              ORDER BY created_at DESC LIMIT 3`
          );
          return { failed: rows[0]?.failed ?? 0, pending: rows[0]?.pending ?? 0, sample };
        }),
        probe(async () => {
          const { rows } = await query(
            `SELECT
               (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'error' AND reviewed_at IS NULL) AS errors,
               (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes') AS stale,
               (SELECT COUNT(*)::int FROM push_outbox WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '5 minutes') AS fresh`
          );
          const { rows: sample } = await query(
            `SELECT id, title, error, created_at
               FROM push_outbox
              WHERE status = 'error' AND reviewed_at IS NULL
              ORDER BY created_at DESC LIMIT 3`
          );
          return {
            errors: rows[0]?.errors ?? 0,
            stale: rows[0]?.stale ?? 0,
            fresh: rows[0]?.fresh ?? 0,
            sample,
          };
        }),
        probe(async () =>
          (
            await query(
              `SELECT COUNT(*)::int AS n FROM ailogs WHERE status ILIKE 'error' AND reviewed_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours'`
            )
          ).rows[0]?.n ?? 0
        ),
        probe(async () =>
          (
            await query(
              `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'login_failure' AND created_at >= NOW() - INTERVAL '24 hours'`
            )
          ).rows[0]?.n ?? 0
        ),
        probe(async () =>
          (
            await query(`SELECT setting_value FROM system_settings WHERE setting_key = $1`, [
              CRON_HEARTBEAT_KEY,
            ])
          ).rows[0]?.setting_value?.at ?? null
        ),
        probe(async () => {
          const { data, error } = await getAdminClient().storage.listBuckets();
          if (error) return { ok: false, error: error.message };
          return { ok: true, bucketsCount: (data || []).length };
        }, { ok: false, error: "Storage service unreachable" }),
        probe(async () => {
          const serverKey = getServerKey();
          if (!serverKey)
            return {
              warning: true,
              message: "TomTom API key not configured — running in heuristic mode",
            };
          const started = Date.now();
          const routeRes = await fetchTomTomRoute(
            [14.5995, 120.9842],
            [14.5547, 121.0244],
            { timeoutMs: 3500 }
          );
          return { ok: Boolean(routeRes), latencyMs: Date.now() - started };
        }, { ok: false, error: "TomTom routing probe unreachable" }),
      ]);

    const { rows, overall } = buildHealthRows({
      appErrors15m,
      db,
      integrationFailed: integration?.failed ?? null,
      integrationPending: integration?.pending ?? null,
      integrationSample: integration?.sample ?? [],
      pushErrors: push?.errors ?? null,
      pushStalePending: push?.stale ?? null,
      pushFreshPending: push?.fresh ?? 0,
      pushSample: push?.sample ?? [],
      aiErrors24h: ai,
      loginFailures24h: auth,
      syncLastOkAt: sync,
      storage,
      maps,
      now,
    });

    // Extract active incidents (any non-operational subsystems)
    const incidents = rows
      .filter((r) => r.state === "degraded" || r.state === "attention")
      .map((r) => ({
        id: `inc-${r.id}`,
        subsystemId: r.id,
        subsystem: r.label,
        severity: r.state === "degraded" ? "critical" : "warning",
        title: r.summary,
        what: r.what,
        impact: r.impact,
        recommendedAction: r.recommendedAction,
        actions: r.actions || [],
      }));

    // Persist the observed sample before reading history; a fresh installation
    // starts with one real sample rather than a manufactured baseline.
    await recordHealthSnapshot({
      overall,
      availabilityPct: overall === "degraded" ? 0 : 100,
      dbLatencyMs: db?.latencyMs ?? 0,
      appErrorsCount: appErrors15m ?? 0,
      activeIncidentsCount: incidents.length,
      subsystems: {
        overall,
        db: db?.ok,
        dbLatencyMs: db?.latencyMs,
        storage: storage?.ok,
        maps: maps?.ok,
      },
    });

    const telemetry = await getHealthTelemetry(timeframe);
    telemetry.kpis.dbLatencyCurrent = db?.ok ? db.latencyMs : null;

    // Sync active incident count into KPIs
    telemetry.kpis.activeIncidents = incidents.length;

    return ok({
      rows,
      overall,
      checked_at: new Date(now).toISOString(),
      timeframe,
      kpis: telemetry.kpis,
      charts: telemetry.charts,
      incidents,
    });
  } catch (e) {
    return handleError(e);
  }
}
