import { requireAuth, ok, handleError, AuthError, absoluteTtlSecondsOf } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { IDLE_TIMEOUT_SECONDS, WEB_SESSION_TTL_SECONDS } from "@/lib/auth/session-policy";

/**
 * Roles holding a web session. The heartbeat is role-agnostic session
 * infrastructure — it only reads and slides the caller's OWN session row —
 * so every role with a web workspace belongs here. `mechanic` (id 10,
 * `/mechanic`) and `driver` (`/driver`) were missing, which 403'd their
 * heartbeats: console spam plus a `last_seen_at` that never slides, so an
 * active mechanic/driver is idle-logged-out anyway.
 */
const DASHBOARD_ROLES = ["super_admin", "admin", "fleet_manager", "dispatcher", "management", "driver", "mechanic"];

/**
 * GET /api/auth/heartbeat
 * Returns authoritative session expiration timestamps without altering last_seen_at.
 *
 * Alongside the deadlines it reports the two timings this session was minted
 * with — the idle window and the absolute TTL — because the client's countdown,
 * warning threshold and dialog copy are all derived from them. Both come from
 * the session ROW, not from the current policy: a saved configuration governs
 * sessions created after it was saved, so quoting the live policy to an older
 * session would describe a limit it never had.
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
      absoluteTtlSeconds: details.absoluteTtlSeconds ?? WEB_SESSION_TTL_SECONDS,
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
        RETURNING created_at, last_seen_at, expires_at, idle_timeout_seconds`,
      [sessionId]
    );

    const updated = rows[0];
    if (!updated) {
      throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_EXPIRED");
    }

    const idleSeconds = Number(updated.idle_timeout_seconds) || IDLE_TIMEOUT_SECONDS;
    const idleExpiresAt = new Date(new Date(updated.last_seen_at).getTime() + idleSeconds * 1000).toISOString();

    return ok({
      ok: true,
      lastSeenAt: updated.last_seen_at,
      idleExpiresAt,
      expiresAt: updated.expires_at,
      idleTimeoutSeconds: idleSeconds,
      absoluteTtlSeconds: absoluteTtlSecondsOf(updated) ?? WEB_SESSION_TTL_SECONDS,
    });
  } catch (e) {
    return handleError(e);
  }
}
