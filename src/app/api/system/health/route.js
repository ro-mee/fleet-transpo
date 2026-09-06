import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { buildHealthRows, CRON_HEARTBEAT_KEY } from "@/lib/system-health";

/**
 * GET /api/system/health
 *
 * Detection surface for System Health (owns detection + remediation ROUTING;
 * each specialized module owns its fix). Restricted to audit-read —
 * rows carry failure text and reporter metadata.
 *
 * Every probe is isolated: one failing probe marks its row unknown instead
 * of 500ing the whole response. Exception: a TOTAL database outage breaks
 * authentication before this code runs — the UI then shows its own
 * "System Health unavailable" fallback (see the /system/health page).
 *
 * Response: { rows, overall, checked_at }. Row action descriptors use
 * kind link (href), post (endpoint), or refetch — the page maps each kind
 * to behavior without hardcoding URLs.
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

    const [appErrors15m, db, integration, push, ai, auth, sync] = await Promise.all([
      probe(async () =>
        (await query(
          `SELECT COUNT(*)::int AS n FROM app_errors WHERE created_at >= NOW() - INTERVAL '15 minutes'`
        )).rows[0]?.n ?? 0
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
        // Only UNREVIEWED errors count: reviewed rows are acknowledged history
        // (see POST ../push-review), not active failures.
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
        (await query(
          `SELECT COUNT(*)::int AS n FROM ailogs WHERE status ILIKE 'error' AND reviewed_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours'`
        )).rows[0]?.n ?? 0
      ),
      probe(async () =>
        (await query(
          `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'login_failure' AND created_at >= NOW() - INTERVAL '24 hours'`
        )).rows[0]?.n ?? 0
      ),
      probe(async () =>
        (await query(`SELECT setting_value FROM system_settings WHERE setting_key = $1`, [
          CRON_HEARTBEAT_KEY,
        ])).rows[0]?.setting_value?.at ?? null
      ),
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
      now,
    });

    return ok({ rows, overall, checked_at: new Date(now).toISOString() });
  } catch (e) {
    return handleError(e);
  }
}
