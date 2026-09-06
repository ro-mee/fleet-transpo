import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  signAccessToken,
  signRefreshToken,
} from "@/lib/auth/mobile-token";
import { consumeFactor } from "@/lib/auth/mfa";

/**
 * POST /api/mobile/auth/login
 *
 * The native client cannot hold the httpOnly NextAuth cookie, so it exchanges
 * credentials for a token pair here. Credential checking mirrors the Credentials
 * provider in src/lib/auth.js; only the session mechanism differs.
 *
 * This MVP is driver-only, so non-driver accounts are rejected rather than
 * issued a token they have no screens for.
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const email = (body?.email || "").toString().toLowerCase().trim();
    const password = body?.password || "";

    if (!email || !password) {
      return err("Email and password are required", 400);
    }

    // Mirror the web login's 5/min throttle (src/lib/auth.js). Per-IP and
    // per-account, so neither a spoofed client nor a single account can drive
    // unlimited bcrypt compares. The mobile credential endpoint was previously
    // unthrottled — the largest brute-force gap in the system.
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mobile-login:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mobile-login:account:${email}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      const retryAfter = Math.max(ipBucket.retryAfter, accountBucket.retryAfter);
      return new Response(
        JSON.stringify({ error: `Too many attempts. Try again in ${retryAfter} seconds.` }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) } }
      );
    }

    const { rows } = await query(
      `SELECT e.employee_id,
              e.email,
              e.password_hash,
              e.first_name,
              e.last_name,
              e.phone,
              e.auth_version,
              r.role_name,
              d.driver_id,
              d.driver_status,
              d.license_number
         FROM employees e
         LEFT JOIN roles r   ON r.role_id = e.role_id
         LEFT JOIN drivers d ON d.employee_id = e.employee_id
                            AND d.deleted_at IS NULL
        WHERE e.email = $1
          AND e.deleted_at IS NULL
          AND e.status = 'Active'
        LIMIT 1`,
      [email]
    );

    const employee = rows[0];

    // Always spend the bcrypt work even when the account does not exist, so
    // account existence cannot be inferred from response timing.
    const valid = await bcrypt.compare(
      String(password),
      employee?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
    );
    if (!employee || !valid) {
      await writeAudit(req, null, {
        action: "login_failure",
        resource: "authentication",
        resourceId: employee?.employee_id,
        newValues: { channel: "mobile" },
      });
      return err("Invalid email or password", 401);
    }

    if (employee.role_name !== "driver") {
      await writeAudit(req, null, {
        action: "login_failure",
        resource: "authentication",
        resourceId: employee.employee_id,
        newValues: { channel: "mobile", reason: "non_driver" },
      });
      return err("This app is for drivers only", 403);
    }
    if (!employee.driver_id) {
      await writeAudit(req, null, {
        action: "login_failure",
        resource: "authentication",
        resourceId: employee.employee_id,
        newValues: { channel: "mobile", reason: "missing_driver_link" },
      });
      return err("No driver record is linked to this account", 403);
    }

    const factorCode = body?.totpCode || body?.recoveryCode;
    let mfaRows;
    try {
      ({ rows: mfaRows } = await query(
        `SELECT enabled_at FROM employee_mfa WHERE employee_id = $1 LIMIT 1`,
        [employee.employee_id]
      ));
    } catch {
      return err("MFA_UNAVAILABLE", 503);
    }
    if (mfaRows[0]?.enabled_at) {
      if (!factorCode) {
        await writeAudit(req, null, {
          action: "mfa_required",
          resource: "authentication",
          resourceId: employee.employee_id,
          newValues: { channel: "mobile" },
        });
        return err("MFA_REQUIRED", 401);
      }
      const [mfaIpBucket, mfaAccountBucket] = await Promise.all([
        rateLimit(`mfa-mobile-login:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
        rateLimit(`mfa-mobile-login:account:${employee.employee_id}`, { limit: 5, windowMs: 60_000 }),
      ]);
      if (!mfaIpBucket.allowed || !mfaAccountBucket.allowed) {
        return err("Too many verification attempts. Try again in a minute.", 429);
      }
      let factor;
      try {
        factor = await withTransaction((tx) => consumeFactor(tx, employee.employee_id, factorCode));
      } catch {
        return err("MFA_UNAVAILABLE", 503);
      }
      if (!factor.ok) {
        await writeAudit(req, null, {
          action: "mfa_failure",
          resource: "authentication",
          resourceId: employee.employee_id,
          newValues: { channel: "mobile", reason: factor.reason },
        });
        return err("MFA_INVALID", 401);
      }
    }

    const { token: refreshToken, familyId } = await signRefreshToken({
      employeeId: employee.employee_id,
      authVersion: employee.auth_version,
    });
    const accessToken = await signAccessToken({
      employeeId: employee.employee_id,
      role: employee.role_name,
      driverId: employee.driver_id,
      authVersion: employee.auth_version,
      familyId,
    });

    await query(
      `INSERT INTO mobile_refresh_tokens
         (employee_id, token_hash, family_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5, $6)`,
      [
        employee.employee_id,
        hashToken(refreshToken),
        familyId,
        REFRESH_TOKEN_TTL_SECONDS,
        clientIp(req),
        req.headers?.get?.("user-agent") || null,
      ]
    );

    // Opportunistic cleanup keeps the small token table bounded without a
    // second scheduler or migration job.
    try {
      await query(
        `DELETE FROM mobile_refresh_tokens
          WHERE expires_at <= NOW()
             OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')`
      );
    } catch (cleanupError) {
      console.warn("Failed to prune old mobile refresh tokens:", cleanupError?.message || cleanupError);
    }

    await writeAudit(req, null, {
      action: "login_success",
      resource: "authentication",
      resourceId: employee.employee_id,
      newValues: { channel: "mobile" },
    });

    return ok({
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      driver: {
        driverId: employee.driver_id,
        employeeId: employee.employee_id,
        email: employee.email,
        firstName: employee.first_name,
        lastName: employee.last_name,
        phone: employee.phone,
        status: employee.driver_status,
        licenseNumber: employee.license_number,
      },
    });
  } catch (e) {
    return handleError(e, { req });
  }
}
