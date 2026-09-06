import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/system/health/push-review
 *
 * Acknowledge permanently undeliverable push failures (e.g. the driver never
 * registered a device token — retry can never fix those, yet the all-time
 * error counter would keep the Push row red forever). Marks every currently
 * unreviewed error row reviewed instead of deleting it: history is preserved
 * with the reviewer's identity, and health/activity counters — which count
 * unreviewed rows only — clear. system_admin only, throttled, audit-logged.
 *
 * Response: { reviewed_ids, count }.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin"]);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`health-review-push:ip:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }),
      rateLimit(`health-review-push:account:${session.user.employeeId ?? "none"}`, {
        limit: 10,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const { rows } = await query(
      `UPDATE push_outbox
          SET reviewed_at = NOW(), reviewed_by = $1
        WHERE status = 'error' AND reviewed_at IS NULL
        RETURNING id`
      ,
      [session.user.employeeId ?? null]
    );
    const reviewed_ids = rows.map((r) => r.id);

    await writeAudit(req, session, {
      action: "health_review_push",
      resource: "push_outbox",
      newValues: { reviewed_ids, count: reviewed_ids.length },
    });
    return ok({ reviewed_ids, count: reviewed_ids.length });
  } catch (e) {
    return handleError(e, { req });
  }
}
