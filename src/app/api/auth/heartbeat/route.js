import { requireAuth, ok, handleError, AuthError } from "@/lib/api/utils";
import { query } from "@/lib/db";

const DASHBOARD_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management"];

/**
 * GET /api/auth/heartbeat
 * Returns authoritative session expiration timestamps without altering last_seen_at.
 */
export async function GET(req) {
  try {
    const session = await requireAuth(req, DASHBOARD_ROLES);
    const details = session.user?.sessionDetails;
    if (!details) {
      return ok({ ok: true });
    }
    return ok({
      ok: true,
      lastSeenAt: details.lastSeenAt,
      idleExpiresAt: details.idleExpiresAt,
      expiresAt: details.expiresAt,
      idleTimeoutSeconds: details.idleTimeoutSeconds,
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST /api/auth/heartbeat
 * Records verified human activity or "Stay signed in" extension.
 * Updates last_seen_at to NOW() and slides the idle deadline by idle_timeout_seconds.
 * Absolute maximum (expires_at) is NEVER extended.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, DASHBOARD_ROLES);
    const sessionId = session.user?.sessionId;
    if (!sessionId) {
      return ok({ ok: true });
    }

    const { rows } = await query(
      `UPDATE web_sessions
          SET last_seen_at = NOW()
        WHERE session_id = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        RETURNING last_seen_at, expires_at, idle_timeout_seconds`,
      [sessionId]
    );

    const updated = rows[0];
    if (!updated) {
      throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_EXPIRED");
    }

    const idleSeconds = Number(updated.idle_timeout_seconds) || 3600;
    const idleExpiresAt = new Date(new Date(updated.last_seen_at).getTime() + idleSeconds * 1000).toISOString();

    return ok({
      ok: true,
      lastSeenAt: updated.last_seen_at,
      idleExpiresAt,
      expiresAt: updated.expires_at,
      idleTimeoutSeconds: idleSeconds,
    });
  } catch (e) {
    return handleError(e);
  }
}
