// System Health evaluation — pure row builder + cron heartbeat helper.
//
// Thresholds locked 2026-09-06 (failure-semantic first, counts second; each
// subsystem carries its own numbers, deliberately NOT one universal value):
//
//   Application Runtime   0/15m operational · 1–4 attention · 5+ degraded
//   Database              <300ms operational · 300–1000ms attention · >1000ms degraded
//                         probe failure itself → degraded (a SELECT 1 that cannot
//                         run IS the outage signal); a TOTAL db outage breaks auth
//                         before this code runs, so the UI shows its own
//                         "unavailable" fallback for that case.
//   Integrations          0 failed+0 pending operational · pending>0 attention · failed>0 degraded
//   Push                  no stale pending/error operational · pending older than
//                         5m attention · any error degraded
//   AI Services           0/24h operational · 1–4 attention · 5+ degraded
//   Authentication        0–4/24h operational · 5–19 attention · 20+ degraded
//   Scheduled Jobs        heartbeat ≤24h operational · 24–26h attention · >26h/missing degraded
//
// Architecture rule: System Health owns DETECTION and remediation ROUTING;
// the specialized module owns the actual fix (Error Log, AI Logs,
// Integration module, Audit/Security). No auto-fix of anything destructive.

import { query } from "@/lib/db";

export const HEALTH_STATES = ["operational", "attention", "degraded", "unknown"];

const STATE_RANK = { operational: 0, unknown: 1, attention: 2, degraded: 3 };

export const HEALTH_THRESHOLDS = {
  appErrorsWindowMin: 15,
  appErrorsAttention: 1,
  appErrorsDegraded: 5,
  dbLatencyAttentionMs: 300,
  dbLatencyDegradedMs: 1000,
  loginAttention: 5,
  loginDegraded: 20,
  aiAttention: 1,
  aiDegraded: 5,
  syncAttentionH: 24,
  syncDegradedH: 26,
  pushStalePendingMin: 5,
};

export const CRON_HEARTBEAT_KEY = "cron_sync_last_ok";

/**
 * Build the seven health rows from gathered signals. Pure (no I/O) —
 * exhaustively unit-tested in system-health.test.js.
 *
 * @param {object} s signals; any probe may be null (unknown) without
 *   breaking the other rows.
 * @returns {{ rows: object[], overall: string }}
 */
export function buildHealthRows(s = {}) {
  const rows = [appRow(s), dbRow(s), integrationRow(s), pushRow(s), aiRow(s), authRow(s), syncRow(s)];
  if (s.storage !== undefined) rows.push(storageRow(s));
  if (s.maps !== undefined) rows.push(mapsRow(s));
  const overall = rows.reduce(
    (worst, r) => (STATE_RANK[r.state] > STATE_RANK[worst] ? r.state : worst),
    "operational"
  );
  return { rows, overall };
}

function appRow(s) {
  const c = s.appErrors15m;
  if (c === null || c === undefined) return unknownRow("app-runtime", "Application Runtime");
  if (c >= HEALTH_THRESHOLDS.appErrorsDegraded)
    return {
      id: "app-runtime",
      label: "Application Runtime",
      state: "degraded",
      summary: `${c} application errors in the last 15 minutes`,
      what: `${c} unexpected failures were recorded in the last 15 minutes.`,
      impact: "Depending on route, user actions may have failed with a generic error.",
      recommendedAction: "Review the affected flow in the Error Log.",
      actions: [
        { id: "view-errors", kind: "link", label: "View Error Log", href: "/system/errors" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  if (c >= HEALTH_THRESHOLDS.appErrorsAttention)
    return {
      id: "app-runtime",
      label: "Application Runtime",
      state: "attention",
      summary: `${c} application error${c === 1 ? "" : "s"} in the last 15 minutes`,
      what: "Isolated unexpected failure(s) — not yet a repeated pattern.",
      impact: "Likely limited to the affected request(s).",
      recommendedAction: "Review the affected flow in the Error Log.",
      actions: [
        { id: "view-errors", kind: "link", label: "View Error Log", href: "/system/errors" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "app-runtime",
    label: "Application Runtime",
    state: "operational",
    summary: "No application errors in the last 15 minutes",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function dbRow(s) {
  if (!s.db || s.db.ok !== true)
    return {
      id: "database",
      label: "Database",
      state: "degraded",
      summary: "Database probe failed (SELECT 1 did not return)",
      what: "The database did not answer a trivial probe.",
      impact: "Reads and writes across the platform are failing or about to fail.",
      recommendedAction: "Manual infrastructure intervention — check the database host, credentials, and connection limits.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  const ms = s.db.latencyMs;
  if (typeof ms === "number" && ms > HEALTH_THRESHOLDS.dbLatencyDegradedMs)
    return {
      id: "database",
      label: "Database",
      state: "degraded",
      summary: `Database responding in ${ms}ms (over ${HEALTH_THRESHOLDS.dbLatencyDegradedMs}ms)`,
      what: "The database answers, but far too slowly for interactive use.",
      impact: "Pages and API calls will feel hung; timeouts are likely.",
      recommendedAction: "Manual infrastructure intervention — check for long-running queries, connection exhaustion, or host load.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  if (typeof ms === "number" && ms > HEALTH_THRESHOLDS.dbLatencyAttentionMs)
    return {
      id: "database",
      label: "Database",
      state: "attention",
      summary: `Database responding in ${ms}ms`,
      what: "Latency is elevated but the database is functional.",
      impact: "Some slowness possible under load.",
      recommendedAction: "Watch; re-check after peak load passes.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  return {
    id: "database",
    label: "Database",
    state: "operational",
    summary: typeof ms === "number" ? `Responding in ${ms}ms` : "Responding normally",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function integrationRow(s) {
  const failed = s.integrationFailed;
  const pending = s.integrationPending;
  if (failed === null || failed === undefined || pending === null || pending === undefined)
    return unknownRow("integrations", "Integrations");
  if (failed > 0)
    return {
      id: "integrations",
      label: "Integrations",
      state: "degraded",
      summary: `${failed} failed outbound deliver${failed === 1 ? "y" : "ies"} in the last 24 hours`,
      what: "Booking integration delivery failed — status updates never reached the Booking system.",
      impact: `${failed} outbound event${failed === 1 ? "" : "s"} undelivered${pending > 0 ? `; ${pending} more still pending` : ""}.`,
      recommendedAction: "Retry the failed outbound events.",
      actions: [
        { id: "retry-integration", kind: "post", label: `Retry ${failed} Failed`, endpoint: "/api/system/health/integration-retry" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
      sample: s.integrationSample || [],
    };
  if (pending > 0)
    return {
      id: "integrations",
      label: "Integrations",
      state: "attention",
      summary: `${pending} outbound event${pending === 1 ? "" : "s"} still pending`,
      what: "Outbound events are queued but not yet confirmed delivered.",
      impact: "Booking may be waiting on status updates.",
      recommendedAction: "Retry the pending outbound events, or wait for the scheduled reconciliation.",
      actions: [
        { id: "retry-integration", kind: "post", label: "Retry Pending", endpoint: "/api/system/health/integration-retry" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "integrations",
    label: "Integrations",
    state: "operational",
    summary: "All outbound deliveries confirmed in the last 24 hours",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function pushRow(s) {
  const errors = s.pushErrors;
  const stale = s.pushStalePending;
  const fresh = s.pushFreshPending;
  if (errors === null || errors === undefined || stale === null || stale === undefined)
    return unknownRow("push", "Push Notifications");
  if (errors > 0)
    return {
      id: "push",
      label: "Push Notifications",
      state: "degraded",
      summary: `${errors} push notification${errors === 1 ? "" : "s"} failed to deliver`,
      what: "Driver push deliveries failed (typically: no active device token, or Expo rejected the ticket).",
      impact: "Affected drivers did not receive their dispatch/alert pushes in-app delivery.",
      recommendedAction:
        "Retry the failed pushes; rows that still fail need their device token re-registered from the driver app — or mark them reviewed if they can never deliver (history is kept, the count clears).",
      actions: [
        { id: "retry-push", kind: "post", label: "Retry Failed", endpoint: "/api/system/health/push-retry" },
        { id: "review-push", kind: "post", label: "Mark Reviewed", endpoint: "/api/system/health/push-review" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
      sample: s.pushSample || [],
    };
  if (stale > 0)
    return {
      id: "push",
      label: "Push Notifications",
      state: "attention",
      summary: `${stale} push notification${stale === 1 ? "" : "s"} stuck older than ${HEALTH_THRESHOLDS.pushStalePendingMin} minutes`,
      what: "Push rows are sitting unsent well past normal in-flight time.",
      impact: "Drivers may be waiting on notifications.",
      recommendedAction: "Retry delivery, or wait for the next flush if a sender just ran.",
      actions: [
        { id: "retry-push", kind: "post", label: "Retry Pending", endpoint: "/api/system/health/push-retry" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "push",
    label: "Push Notifications",
    state: "operational",
    summary: fresh > 0 ? `${fresh} in flight, none stuck` : "No failures, nothing stuck",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function aiRow(s) {
  const c = s.aiErrors24h;
  if (c === null || c === undefined) return unknownRow("ai", "AI Services");
  if (c >= HEALTH_THRESHOLDS.aiDegraded)
    return {
      id: "ai",
      label: "AI Services",
      state: "degraded",
      summary: `${c} AI failures in the last 24 hours`,
      what: "The LLM provider is repeatedly failing; deterministic fallbacks are carrying the load.",
      impact: "Narratives and scans degrade to rule-based output until the provider recovers.",
      recommendedAction:
        "Check provider status/quota in AI Logs, then AI Providers — or mark them reviewed if they need a config change first (history is kept, the count clears).",
      actions: [
        { id: "view-ai-logs", kind: "link", label: "View AI Logs", href: "/settings/ai/logs" },
        { id: "review-ai", kind: "post", label: "Mark Reviewed", endpoint: "/api/system/health/ai-review" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  if (c >= HEALTH_THRESHOLDS.aiAttention)
    return {
      id: "ai",
      label: "AI Services",
      state: "attention",
      summary: `${c} AI failure${c === 1 ? "" : "s"} in the last 24 hours`,
      what: "Isolated provider failure(s); fallbacks covered them.",
      impact: "Minimal — deterministic output was served instead.",
      recommendedAction: "Glance at AI Logs; mark reviewed if they need a config change first, no action if isolated.",
      actions: [
        { id: "view-ai-logs", kind: "link", label: "View AI Logs", href: "/settings/ai/logs" },
        { id: "review-ai", kind: "post", label: "Mark Reviewed", endpoint: "/api/system/health/ai-review" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "ai",
    label: "AI Services",
    state: "operational",
    summary: "No AI failures in the last 24 hours",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function authRow(s) {
  const c = s.loginFailures24h;
  if (c === null || c === undefined) return unknownRow("auth", "Authentication");
  if (c >= HEALTH_THRESHOLDS.loginDegraded)
    return {
      id: "auth",
      label: "Authentication",
      state: "degraded",
      summary: `${c} failed sign-in attempts in the last 24 hours`,
      what: "A spike of failed logins — possible credential stuffing or a widely-shared wrong password.",
      impact: "No breach by itself, but the pattern needs a human look.",
      recommendedAction: "Review Security Events (audit trail) for source IPs and targeted accounts. No automatic lockout is applied.",
      actions: [
        { id: "review-audit", kind: "link", label: "Review Security Events", href: "/system/audit" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  if (c >= HEALTH_THRESHOLDS.loginAttention)
    return {
      id: "auth",
      label: "Authentication",
      state: "attention",
      summary: `${c} failed sign-in attempts in the last 24 hours`,
      what: "A handful of failed logins — usually mistyped passwords.",
      impact: "None expected; early warning only.",
      recommendedAction: "Review Security Events if the count keeps climbing.",
      actions: [
        { id: "review-audit", kind: "link", label: "Review Security Events", href: "/system/audit" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "auth",
    label: "Authentication",
    state: "operational",
    summary: c === 0 ? "No failed sign-ins in the last 24 hours" : `${c} failed sign-ins (normal background)`,
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function syncRow(s) {
  const at = s.syncLastOkAt ? new Date(s.syncLastOkAt).getTime() : NaN;
  const now = s.now ?? Date.now();
  if (Number.isNaN(at))
    return {
      id: "sync",
      label: "Scheduled Jobs",
      state: "degraded",
      summary: "No successful sync recorded",
      what: "The scheduled sync has never reported success (or its heartbeat is missing).",
      impact: "Vehicle/driver statuses, compliance notifications, and error-log pruning may not be running.",
      recommendedAction: "Run Sync Now, then confirm the external scheduler is configured (it must hit /api/cron/sync on an interval).",
      actions: [
        { id: "run-sync", kind: "post", label: "Run Sync Now", endpoint: "/api/system/health/sync-now" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  const ageH = (now - at) / 3_600_000;
  if (ageH > HEALTH_THRESHOLDS.syncDegradedH)
    return {
      id: "sync",
      label: "Scheduled Jobs",
      state: "degraded",
      summary: `Last successful run ${ageLabel(ageH)} ago`,
      what: "The scheduled sync heartbeat is stale past its expected daily cadence.",
      impact: "Statuses, compliance notifications, and pruning are not running.",
      recommendedAction: "Run Sync Now, then fix the external scheduler.",
      actions: [
        { id: "run-sync", kind: "post", label: "Run Sync Now", endpoint: "/api/system/health/sync-now" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  if (ageH > HEALTH_THRESHOLDS.syncAttentionH)
    return {
      id: "sync",
      label: "Scheduled Jobs",
      state: "attention",
      summary: `Last successful run ${ageLabel(ageH)} ago`,
      what: "The heartbeat is near the edge of its expected cadence.",
      impact: "None yet — one missed window.",
      recommendedAction: "Watch the next scheduled window; run manually if it slips further.",
      actions: [
        { id: "run-sync", kind: "post", label: "Run Sync Now", endpoint: "/api/system/health/sync-now" },
        { id: "recheck", kind: "refetch", label: "Retry Health Check" },
      ],
    };
  return {
    id: "sync",
    label: "Scheduled Jobs",
    state: "operational",
    summary: `Last successful run ${ageLabel(ageH)} ago`,
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function unknownRow(id, label) {
  return {
    id,
    label,
    state: "unknown",
    summary: "Probe did not return — state cannot be determined",
    what: "The health probe for this subsystem failed for an unrelated reason.",
    impact: "Unknown — treat with suspicion until re-checked.",
    recommendedAction: "Retry the health check; investigate the probe if it persists.",
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function ageLabel(ageH) {
  if (ageH < 1) return `${Math.max(1, Math.round(ageH * 60))} min`;
  if (ageH < 48) return `${Math.round(ageH)}h`;
  return `${Math.round(ageH / 24)}d`;
}

/**
 * Record a successful scheduled-sync heartbeat. Called by /api/cron/sync AND
 * POST /api/system/health/sync-now after their sync work succeeds. Never
 * throws (a heartbeat failure must not fail the sync response).
 */
export async function recordSyncHeartbeat() {
  try {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ($1, jsonb_build_object('at', NOW()), NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = jsonb_build_object('at', NOW()), updated_at = NOW()`,
      [CRON_HEARTBEAT_KEY]
    );
    return true;
  } catch {
    return false;
  }
}

function storageRow(s) {
  if (s.storage === null || s.storage === undefined)
    return unknownRow("storage", "File Storage");
  if (s.storage.ok === false)
    return {
      id: "storage",
      label: "File Storage",
      state: "degraded",
      summary: s.storage.error || "Storage service unreachable",
      what: "Supabase file storage did not answer or returned an error.",
      impact: "Driver licenses, inspection media, and receipts cannot be uploaded or loaded.",
      recommendedAction: "Verify Supabase project storage quotas, bucket status, and service credentials.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  const count = s.storage.bucketsCount;
  return {
    id: "storage",
    label: "File Storage",
    state: "operational",
    summary: typeof count === "number" ? `${count} storage buckets active and accessible` : "All storage buckets operational",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function mapsRow(s) {
  if (s.maps === null || s.maps === undefined)
    return unknownRow("maps", "Maps & Routing");
  if (s.maps.ok === false)
    return {
      id: "maps",
      label: "Maps & Routing",
      state: "degraded",
      summary: s.maps.error || "TomTom Routing probe failed",
      what: "TomTom routing service returned an HTTP error or timed out.",
      impact: "Real-time dispatch route calculation may fall back to cached estimates.",
      recommendedAction: "Check TomTom API key quota and network connectivity.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  if (s.maps.warning)
    return {
      id: "maps",
      label: "Maps & Routing",
      state: "attention",
      summary: s.maps.message || "TomTom API key not configured — fallback to Haversine heuristic",
      what: "Live traffic routing is running in fallback heuristic mode.",
      impact: "Trip travel estimates use straight-line approximations instead of live traffic.",
      recommendedAction: "Configure TOMTOM_API_KEY in environment variables.",
      actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
    };
  const ms = s.maps.latencyMs;
  return {
    id: "maps",
    label: "Maps & Routing",
    state: "operational",
    summary: typeof ms === "number" ? `TomTom Routing responding in ${ms}ms` : "TomTom Routing operational",
    what: null,
    impact: null,
    recommendedAction: null,
    actions: [{ id: "recheck", kind: "refetch", label: "Retry Health Check" }],
  };
}

function formatBucketLabel(date, format) {
  const d = new Date(date);
  if (format === "time") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  }
  if (format === "day") {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Record a health snapshot in the system_health_snapshots table.
 */
export async function recordHealthSnapshot(data = {}) {
  try {
    await query(
      `INSERT INTO system_health_snapshots
       (overall_status, availability_pct, db_latency_ms, app_errors_count, active_incidents_count, subsystems, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        data.overall,
        data.availabilityPct,
        data.dbLatencyMs ?? 0,
        data.appErrorsCount ?? 0,
        data.activeIncidentsCount ?? 0,
        JSON.stringify(data.subsystems || {}),
      ]
    );
    return true;
  } catch (e) {
    console.error("Non-fatal error in recordHealthSnapshot:", e?.message);
    return false;
  }
}

/**
 * Gather time-series telemetry and calculated KPIs over the given timeframe.
 * @param {'24h' | '7d' | '30d'} timeframe
 */
export async function getHealthTelemetry(timeframe = "24h") {
  const intervals = {
    "24h": { interval: "24 hours", bucket: "hour", step: "1 hour", format: "time" },
    "7d": { interval: "7 days", bucket: "day", step: "1 day", format: "day" },
    "30d": { interval: "30 days", bucket: "day", step: "1 day", format: "date" },
  };
  const tf = intervals[timeframe] || intervals["24h"];

  const errorDistQuery = `
    WITH time_buckets AS (
      SELECT generate_series(
        date_trunc($1, NOW() - $2::interval),
        date_trunc($1, NOW()),
        $3::interval
      ) AS bucket
    ),
    app_errs AS (
      SELECT date_trunc($1, created_at) AS bucket, COUNT(*)::int AS count
      FROM app_errors
      WHERE created_at >= NOW() - $2::interval
      GROUP BY 1
    ),
    integration_errs AS (
      SELECT date_trunc($1, created_at) AS bucket, COUNT(*)::int AS count
      FROM integration_log
      WHERE direction = 'outbound' AND status = 'failed' AND created_at >= NOW() - $2::interval
      GROUP BY 1
    ),
    push_errs AS (
      SELECT date_trunc($1, created_at) AS bucket, COUNT(*)::int AS count
      FROM push_outbox
      WHERE status = 'error' AND created_at >= NOW() - $2::interval
      GROUP BY 1
    ),
    ai_errs AS (
      SELECT date_trunc($1, created_at) AS bucket, COUNT(*)::int AS count
      FROM ailogs
      WHERE status ILIKE 'error' AND created_at >= NOW() - $2::interval
      GROUP BY 1
    ),
    auth_errs AS (
      SELECT date_trunc($1, created_at) AS bucket, COUNT(*)::int AS count
      FROM audit_logs
      WHERE action = 'login_failure' AND created_at >= NOW() - $2::interval
      GROUP BY 1
    )
    SELECT
      tb.bucket,
      COALESCE(ae.count, 0) AS app_errors,
      COALESCE(ie.count, 0) AS integration_errors,
      COALESCE(pe.count, 0) AS push_errors,
      COALESCE(aie.count, 0) AS ai_errors,
      COALESCE(aue.count, 0) AS auth_errors
    FROM time_buckets tb
    LEFT JOIN app_errs ae ON tb.bucket = ae.bucket
    LEFT JOIN integration_errs ie ON tb.bucket = ie.bucket
    LEFT JOIN push_errs pe ON tb.bucket = pe.bucket
    LEFT JOIN ai_errs aie ON tb.bucket = aie.bucket
    LEFT JOIN auth_errs aue ON tb.bucket = aue.bucket
    ORDER BY tb.bucket ASC;
  `;

  const snapshotsQuery = `
    SELECT
      date_trunc($1, recorded_at) AS bucket,
      AVG(db_latency_ms) FILTER (WHERE subsystems->>'db' = 'true')::int AS avg_latency,
      AVG(availability_pct) FILTER (WHERE overall_status <> 'unknown')::numeric(5,2) AS avg_availability,
      MAX(db_latency_ms)::int AS max_latency,
      COUNT(*) FILTER (WHERE overall_status <> 'unknown')::int AS count
    FROM system_health_snapshots
    WHERE recorded_at >= NOW() - $2::interval AND subsystems ? 'db'
    GROUP BY 1
    ORDER BY 1 ASC;
  `;

  const latenciesQuery = `
    SELECT db_latency_ms
    FROM system_health_snapshots
    WHERE recorded_at >= NOW() - $1::interval AND subsystems->>'db' = 'true'
    ORDER BY db_latency_ms ASC;
  `;

  const pushTotalsQuery = `
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
      COUNT(*)::int AS total
    FROM push_outbox
    WHERE created_at >= NOW() - $1::interval;
  `;

  const [errRows, snapRows, latRows, pushStats] = await Promise.all([
    query(errorDistQuery, [tf.bucket, tf.interval, tf.step]).then((r) => r.rows).catch(() => null),
    query(snapshotsQuery, [tf.bucket, tf.interval]).then((r) => r.rows).catch(() => null),
    query(latenciesQuery, [tf.interval]).then((r) => r.rows).catch(() => null),
    query(pushTotalsQuery, [tf.interval]).then((r) => r.rows[0]).catch(() => null),
  ]);

  const snapMap = new Map((snapRows ?? []).map((s) => [new Date(s.bucket).toISOString(), s]));

  const reliabilityTrend = [];
  const errorDistribution = [];

  let totalAppErrors = 0;
  let totalErrors = 0;

  for (const row of errRows ?? []) {
    const bDate = new Date(row.bucket);
    const iso = bDate.toISOString();
    const snap = snapMap.get(iso);

    const appErr = Number(row.app_errors) || 0;
    const intErr = Number(row.integration_errors) || 0;
    const pushErr = Number(row.push_errors) || 0;
    const aiErr = Number(row.ai_errors) || 0;
    const authErr = Number(row.auth_errors) || 0;
    const bTotal = appErr + intErr + pushErr + aiErr + authErr;

    totalAppErrors += appErr;
    totalErrors += bTotal;

    const label = formatBucketLabel(bDate, tf.format);

    const calcAvailability = snap?.avg_availability == null ? null : Number(snap.avg_availability);
    const latency = snap?.avg_latency == null ? null : Number(snap.avg_latency);

    reliabilityTrend.push({
      timestamp: iso,
      label,
      availability: calcAvailability,
      latency,
      errorCount: bTotal,
    });

    errorDistribution.push({
      timestamp: iso,
      label,
      appErrors: appErr,
      integrationErrors: intErr,
      pushErrors: pushErr,
      aiErrors: aiErr,
      authErrors: authErr,
      total: bTotal,
    });
  }

  const availabilityCount = (snapRows ?? []).reduce((count, row) => count + Number(row.count), 0);
  const overallAvailability = availabilityCount
    ? Number((snapRows.reduce((sum, row) => sum + Number(row.avg_availability) * Number(row.count), 0) / availabilityCount).toFixed(1))
    : null;

  const sortedLats = (latRows ?? [])
    .map((r) => Number(r.db_latency_ms))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  const avgLatency =
    sortedLats.length > 0 ? Math.round(sortedLats.reduce((s, v) => s + v, 0) / sortedLats.length) : null;
  const p95Index = Math.max(0, Math.ceil(sortedLats.length * 0.95) - 1);
  const p95Latency = sortedLats.length > 0 ? sortedLats[p95Index] : null;
  const peakLatency = sortedLats.length > 0 ? sortedLats[sortedLats.length - 1] : null;

  const pushDelivered = Number(pushStats?.sent) || 0;
  const pushFail = Number(pushStats?.errors) || 0;
  const pushTotal = pushStats ? Number(pushStats.total) : null;
  const pushSuccessRate = pushTotal > 0 ? Number(((pushDelivered / pushTotal) * 100).toFixed(1)) : null;

  return {
    kpis: {
      availability: overallAvailability,
      dbLatencyAvg: avgLatency,
      dbLatencyP95: p95Latency,
      dbLatencyPeak: peakLatency,
      pushSuccessRate,
      pushDelivered,
      pushFailed: pushFail,
      pushTotal,
      totalErrors: errRows ? totalErrors : null,
      appErrorsCount: errRows ? totalAppErrors : null,
    },
    charts: {
      reliabilityTrend,
      errorDistribution,
    },
  };
}
