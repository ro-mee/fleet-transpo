import { query } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import { hashToken, verifyRefreshToken } from "@/lib/auth/mobile-token";

/**
 * POST /api/mobile/auth/logout
 *
 * Authenticated by the refresh token, not the access token: a driver signing out
 * after leaving the app idle for an hour has an expired access token, and that
 * should not strand a live refresh token in the database.
 *
 * Idempotent — revoking an already-revoked or unknown token still returns 200,
 * so the client can clear its storage unconditionally.
 */
export async function POST(req) {
  try {
    const { refreshToken, allDevices } = await req.json();

    if (!refreshToken) {
      return err("Refresh token is required", 400);
    }

    const claims = await verifyRefreshToken(refreshToken);
    if (!claims) {
      // Nothing to revoke, but the client should still forget the token.
      return ok({ message: "Signed out" });
    }

    if (allDevices) {
      await query(
        `UPDATE mobile_refresh_tokens
            SET revoked_at = NOW()
          WHERE employee_id = $1
            AND revoked_at IS NULL`,
        [claims.employeeId]
      );
    } else {
      await query(
        `UPDATE mobile_refresh_tokens
            SET revoked_at = NOW()
          WHERE token_hash = $1
            AND employee_id = $2
            AND revoked_at IS NULL`,
        [hashToken(refreshToken), claims.employeeId]
      );
    }

    return ok({ message: "Signed out" });
  } catch (e) {
    return handleError(e);
  }
}
