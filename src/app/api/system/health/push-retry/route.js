import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { flushOutbox } from "@/services/push.service";

/**
 * POST /api/system/health/push-retry
 *
 * One-click safe remediation: re-drives every pending push_outbox row through
 * the SAME flushOutbox() the dispatch flow uses — no parallel delivery logic,
 * no privilege bypass. system_admin only, throttled (Expo + DB are shared
 * resources), and audit-logged like any other mutation.
 *
 * Response: { retried, delivered, still_failed, failures[] } (failures capped
 * at 20 rows). A fatal flush failure returns 500 WITHOUT an app_errors row —
 * retrying during an outage must not pile new error rows per click.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin"]);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`health-retry-push:ip:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }),
      rateLimit(`health-retry-push:account:${session.user.employeeId ?? "none"}`, {
        limit: 10,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const results = await flushOutbox();
    const rows = (Array.isArray(results) ? results : []).filter(
      (r) => r && typeof r.id !== "undefined"
    );
    if (!rows.length && results?.[0]?.error) {
      return err(`Push retry failed: ${results[0].error}`, 500);
    }
    const summary = {
      retried: rows.length,
      delivered: rows.filter((r) => r.delivered).length,
      still_failed: rows.filter((r) => !r.delivered).length,
      failures: rows
        .filter((r) => !r.delivered)
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          error:
            r.results?.[0]?.error ||
            (Array.isArray(r.results?.[0]?.data)
              ? JSON.stringify(r.results[0].data).slice(0, 300)
              : "no delivery"),
        })),
    };

    await writeAudit(req, session, {
      action: "health_retry_push",
      resource: "push_outbox",
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
