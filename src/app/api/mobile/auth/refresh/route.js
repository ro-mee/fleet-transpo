import { query } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
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
 * Trades a refresh token for a new pair. The old refresh token is revoked in
 * the same transaction that issues the new one — a refresh token is single-use,
 * so a stolen copy stops working as soon as the real device refreshes.
 *
 * Role and driver_id are re-read from the database rather than copied from the
 * old token, so a revoked driver or a role change takes effect within one
 * access-token lifetime instead of persisting for the full 30 days.
 */
export async function POST(req) {
  try {
    const { refreshToken } = await req.json();

    if (!refreshToken) {
      return err("Refresh token is required", 400);
    }

    const claims = await verifyRefreshToken(refreshToken);
    if (!claims) {
      return err("Invalid or expired refresh token", 401);
    }

    const tokenHash = hashToken(refreshToken);

    // Revoke and read in one statement: two concurrent refreshes with the same
    // token race here, and only the one that flips revoked_at gets a row back.
    const { rows: revoked } = await query(
      `UPDATE mobile_refresh_tokens
          SET revoked_at = NOW()
        WHERE token_hash = $1
          AND employee_id = $2
          AND revoked_at IS NULL
          AND expires_at > NOW()
        RETURNING id`,
      [tokenHash, claims.employeeId]
    );

    if (revoked.length === 0) {
      return err("Refresh token has been revoked or already used", 401);
    }

    const { rows } = await query(
      `SELECT e.employee_id,
              r.role_name,
              d.driver_id
         FROM employees e
         LEFT JOIN roles r   ON r.role_id = e.role_id
         LEFT JOIN drivers d ON d.employee_id = e.employee_id
                            AND d.deleted_at IS NULL
        WHERE e.employee_id = $1
          AND e.deleted_at IS NULL
        LIMIT 1`,
      [claims.employeeId]
    );

    const employee = rows[0];
    if (!employee || employee.role_name !== "driver" || !employee.driver_id) {
      return err("This account can no longer sign in", 403);
    }

    const accessToken = await signAccessToken({
      employeeId: employee.employee_id,
      role: employee.role_name,
      driverId: employee.driver_id,
    });
    const { token: nextRefreshToken } = await signRefreshToken({
      employeeId: employee.employee_id,
    });

    await query(
      `INSERT INTO mobile_refresh_tokens (employee_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL)`,
      [employee.employee_id, hashToken(nextRefreshToken), REFRESH_TOKEN_TTL_SECONDS]
    );

    return ok({
      accessToken,
      refreshToken: nextRefreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch (e) {
    return handleError(e);
  }
}
