import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_SECONDS,
  createTrustedDeviceToken,
  hashTrustedDeviceToken,
  normalizeTrustedDeviceToken,
  trustedDeviceCookieOptions,
} from "@/lib/auth/trusted-device";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const authVersion = Number(session.user.authVersion);
    if (!Number.isSafeInteger(authVersion)) return err("Session cannot remember this device", 409);

    const cookieStore = await cookies();
    const currentToken = normalizeTrustedDeviceToken(cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value);
    const token = createTrustedDeviceToken();
    const tokenHash = hashTrustedDeviceToken(token);
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_SECONDS * 1000);
    const employeeId = session.user.employeeId;
    const ip = clientIp(req);
    const userAgent = req.headers.get("user-agent") || null;

    const device = await withTransaction(async (tx) => {
      if (currentToken) {
        await tx.query(
          `UPDATE trusted_web_devices
              SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE employee_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
          [employeeId, hashTrustedDeviceToken(currentToken)]
        );
      }

      const inserted = await tx.query(
        `INSERT INTO trusted_web_devices
           (employee_id, token_hash, auth_version, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING device_id`,
        [employeeId, tokenHash, authVersion, expiresAt, ip, userAgent]
      );
      return inserted.rows[0];
    });

    const response = NextResponse.json({
      remembered: true,
      expiresAt: expiresAt.toISOString(),
    });
    response.cookies.set(TRUSTED_DEVICE_COOKIE, token, trustedDeviceCookieOptions());

    await writeAudit(req, session, {
      action: "trusted_device_enabled",
      resource: "trusted_web_device",
      resourceId: device?.device_id,
      newValues: { expires_in_days: 30 },
    });

    return response;
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req) {
  try {
    const session = await requireAuth(req, "*");
    const cookieStore = await cookies();
    const token = normalizeTrustedDeviceToken(cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value);
    let revoked = false;

    if (token) {
      const result = await query(
        `UPDATE trusted_web_devices
            SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE employee_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
        [session.user.employeeId, hashTrustedDeviceToken(token)]
      );
      revoked = Boolean(result.rowCount);
    }

    const response = NextResponse.json({ remembered: false, revoked });
    response.cookies.set(TRUSTED_DEVICE_COOKIE, "", trustedDeviceCookieOptions(0));

    if (revoked) {
      await writeAudit(req, session, {
        action: "trusted_device_disabled",
        resource: "trusted_web_device",
        newValues: { current_device_only: true },
      });
    }

    return response;
  } catch (error) {
    return handleError(error);
  }
}
