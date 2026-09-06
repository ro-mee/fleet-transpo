import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/system/health/ai-review
 *
 * Acknowledge AI failures that cannot be fixed from the dashboard (e.g. a
 * stale provider model name needing a config change — regenerating just
 * fails again). Same pattern as POST ../push-review: marks every currently
 * unreviewed AI error row reviewed instead of deleting it, so AI Logs keeps
 * full history with the reviewer's identity while health counts unreviewed
 * rows only. system_admin only, throttled, audit-logged.
 *
 * Ownership note: this does NOT move AI failures into app_errors — they stay
 * exclusively in ailogs, owned by the AI module. Review only clears the
 * health signal, exactly like push-review does for push_outbox.
 *
 * Response: { reviewed_ids, count } (ids are ailogs log_id values).
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin"]);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`health-review-ai:ip:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }),
      rateLimit(`health-review-ai:account:${session.user.employeeId ?? "none"}`, {
        limit: 10,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const { rows } = await query(
      `UPDATE ailogs
          SET reviewed_at = NOW(), reviewed_by = $1
        WHERE status ILIKE 'error' AND reviewed_at IS NULL
        RETURNING log_id`
      ,
      [session.user.employeeId ?? null]
    );
    const reviewed_ids = rows.map((r) => r.log_id);

    await writeAudit(req, session, {
      action: "health_review_ai",
      resource: "ailogs",
      newValues: { reviewed_ids, count: reviewed_ids.length },
    });
    return ok({ reviewed_ids, count: reviewed_ids.length });
  } catch (e) {
    return handleError(e, { req });
  }
}
