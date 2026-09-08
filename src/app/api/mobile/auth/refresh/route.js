import { withTransaction } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/lib/auth/mobile-token";

/**
 * POST /api/mobile/auth/refresh
 *
 * Trades a refresh token for a new pair. The old refresh token is revoked and
 * its replacement is inserted in one database transaction. A replay revokes
 * the complete token family so a stolen descendant cannot continue.
 *
 * Role and driver_id are re-read from the database rather than copied from the
 * old token, so a revoked driver or a role change takes effect within one
 * access-token lifetime instead of persisting for the full 30 days.
 */

/**
 * Minimum seconds between two rotations of one family. The foreground poster
 * and the background GPS task run in SEPARATE JS contexts with independent
 * single-flight guards, so both can refresh the same family concurrently;
 * without a cooldown they alternate grace-rotations indefinitely (a 63-row
 * churn was observed in production) until one lands outside the grace window
 * and the replay rule wipes the family — a forced logout from normal use.
 * A legitimate client never refreshes twice inside the cooldown; the loser
 * gets a stateless 429 with no writes, which the mobile client already treats
 * as transient (no logout).
 */
export const ROTATION_COOLDOWN_SECONDS = 10;
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const refreshToken = body?.refreshToken;

    if (!refreshToken) {
      return err("Refresh token is required", 400);
    }

    const claims = await verifyRefreshToken(refreshToken);
    if (!claims) {
      return err("Invalid or expired refresh token", 401);
    }

    const tokenHash = hashToken(refreshToken);
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mobile-refresh:ip:${clientIp(req)}`, { limit: 20, windowMs: 60_000 }),
      rateLimit(`mobile-refresh:account:${claims.employeeId}`, { limit: 20, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      // Tell the client how long to wait: the mobile refresh treats 429 as
      // "wait once, silently" instead of a session problem.
      const retryAfter = Math.max(Number(ipBucket.retryAfter) || 0, Number(accountBucket.retryAfter) || 0);
      return Response.json(
        { error: "Too many requests. Try again later.", retry_after: retryAfter },
        { status: 429 }
      );
    }

    const rotated = await withTransaction(async (tx) => {
      const { rows: existingRows } = await tx.query(
        `SELECT employee_id, family_id
           FROM mobile_refresh_tokens
          WHERE token_hash = $1 AND employee_id = $2
          LIMIT 1`,
        [tokenHash, claims.employeeId]
      );
      const existing = existingRows[0];
      if (!existing) return { invalid: true };

      // Rotation cooldown (see ROTATION_COOLDOWN_SECONDS): concurrent losers
      // are turned away with no state change. Checked inside the transaction
      // so two simultaneous winners cannot both pass.
      const { rows: cooldownRows } = await tx.query(
        `SELECT MAX(created_at) AS last_rotation
           FROM mobile_refresh_tokens
          WHERE family_id = $1 AND employee_id = $2`,
        [existing.family_id, existing.employee_id]
      );
      const lastRotation = cooldownRows[0]?.last_rotation
        ? new Date(cooldownRows[0].last_rotation).getTime()
        : null;
      const elapsedMs = lastRotation ? Date.now() - lastRotation : null;
      if (elapsedMs != null && elapsedMs < ROTATION_COOLDOWN_SECONDS * 1000) {
        return {
          rateLimited: true,
          retryAfter: Math.max(1, Math.ceil((ROTATION_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000)),
        };
      }

      const { rows: revoked } = await tx.query(
        `UPDATE mobile_refresh_tokens
            SET revoked_at = COALESCE(revoked_at, NOW()), last_used_at = NOW()
          WHERE token_hash = $1
            AND employee_id = $2
            AND (revoked_at IS NULL OR revoked_at >= NOW() - INTERVAL '1 minute')
            AND expires_at > NOW()
          RETURNING id, family_id`,
        [tokenHash, claims.employeeId]
      );

      if (!revoked.length) {
        await tx.query(
          `UPDATE mobile_refresh_tokens
              SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE family_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
          [existing.family_id, existing.employee_id]
        );
        return { replay: true, employeeId: existing.employee_id, familyId: existing.family_id };
      }

      const familyId = revoked[0].family_id;
      if (claims.familyId && claims.familyId !== familyId) {
        await tx.query(
          `UPDATE mobile_refresh_tokens
              SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE family_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
          [familyId, existing.employee_id]
        );
        return { replay: true, employeeId: existing.employee_id, familyId };
      }

      const { rows } = await tx.query(
        `SELECT e.employee_id,
                e.auth_version,
                r.role_name,
                d.driver_id
           FROM employees e
           LEFT JOIN roles r   ON r.role_id = e.role_id
           LEFT JOIN drivers d ON d.employee_id = e.employee_id
                              AND d.deleted_at IS NULL
          WHERE e.employee_id = $1
            AND e.deleted_at IS NULL
            AND e.status = 'Active'
          LIMIT 1`,
        [claims.employeeId]
      );

      const employee = rows[0];
      if (!employee || employee.role_name !== "driver" || !employee.driver_id) {
        return { invalidAccount: true };
      }
      if (!Number.isSafeInteger(Number(claims.authVersion)) || Number(claims.authVersion) !== Number(employee.auth_version)) {
        return { stale: true };
      }

      // Revoke any orphaned descendants generated by dropped connections during the grace period
      await tx.query(
        `UPDATE mobile_refresh_tokens
            SET revoked_at = NOW()
          WHERE family_id = $1
            AND employee_id = $2
            AND revoked_at IS NULL`,
        [familyId, employee.employee_id]
      );

      const accessToken = await signAccessToken({
        employeeId: employee.employee_id,
        role: employee.role_name,
        driverId: employee.driver_id,
        authVersion: employee.auth_version,
        familyId,
      });
      const { token: nextRefreshToken } = await signRefreshToken({
        employeeId: employee.employee_id,
        authVersion: employee.auth_version,
        familyId,
      });

      await tx.query(
        `INSERT INTO mobile_refresh_tokens
           (employee_id, token_hash, family_id, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5, $6)`,
        [
          employee.employee_id,
          hashToken(nextRefreshToken),
          familyId,
          REFRESH_TOKEN_TTL_SECONDS,
          clientIp(req),
          req.headers?.get?.("user-agent") || null,
        ]
      );
      return { accessToken, refreshToken: nextRefreshToken };
    });

    if (rotated.rateLimited) {
      return Response.json(
        {
          error: "Too many requests. Try again later.",
          retry_after: Number(rotated.retryAfter) || ROTATION_COOLDOWN_SECONDS,
        },
        { status: 429 }
      );
    }
    if (rotated.replay) {
      await writeAudit(req, null, {
        action: "refresh_reuse",
        resource: "mobile_refresh_tokens",
        employeeId: rotated.employeeId,
        newValues: { family_revoked: true },
      });
      return err("Refresh token has been revoked or already used", 401);
    }
    if (rotated.invalidAccount || rotated.stale || rotated.invalid) {
      return err("This account can no longer sign in", 401);
    }

    return ok({ ...rotated, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  } catch (e) {
    return handleError(e);
  }
}
