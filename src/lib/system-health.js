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
