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
      return err("Too many requests. Try again later.", 429);
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

      const { rows: revoked } = await tx.query(
        `UPDATE mobile_refresh_tokens
            SET revoked_at = NOW(), last_used_at = NOW()
          WHERE token_hash = $1
            AND employee_id = $2
            AND revoked_at IS NULL
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
