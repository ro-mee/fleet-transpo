import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { reconcileFailedDeliveries } from "@/services/outbound.service";

/**
 * POST /api/system/health/integration-retry
 *
 * One-click safe remediation: retries every undelivered outbound
 * integration_log row through the SAME reconcileFailedDeliveries() the
 * CRON_SECRET /api/cron/reconcile job uses — same gateway, same
 * pending/failed semantics, no bypass. system_admin only, throttled
 * (the Booking gateway is a shared external resource), audit-logged.
 *
 * Response: { gateway, retried, delivered, still_failed, failures[] }
 * (failures capped at 20 rows). Fatal reconcile failure returns 500
 * WITHOUT an app_errors row, same reasoning as push-retry.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin"]);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`health-retry-integration:ip:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }),
      rateLimit(`health-retry-integration:account:${session.user.employeeId ?? "none"}`, {
        limit: 10,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    let result;
    try {
      result = await reconcileFailedDeliveries({ max: 50 });
    } catch (e) {
      return err(`Integration retry failed: ${e?.message || e}`, 500);
    }
    const summary = {
      gateway: result.gateway,
      retried: result.retried,
      delivered: result.delivered,
      still_failed: result.stillFailed,
      failures: (result.results || [])
        .filter((r) => !r.delivered)
        .slice(0, 20)
        .map((r) => ({ log_id: r.logId, error: r.error || "delivery failed" })),
    };

    await writeAudit(req, session, {
      action: "health_retry_integration",
      resource: "integration_log",
      newValues: {
        retried: summary.retried,
        delivered: summary.delivered,
        still_failed: summary.still_failed,
      },
    });
    return ok(summary);
  } catch (e) {
    return handleError(e, { req });
  }
}
