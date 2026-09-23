import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { checkAccountLockout, recordFailedAttempt, clearAccountLockout } from "@/lib/auth/account-lockout";
import { raiseSecurityAlert } from "@/lib/auth/security-alerts";
import { writeAudit } from "@/lib/audit";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  signAccessToken,
  signRefreshToken,
} from "@/lib/auth/mobile-token";
import { recordNewDeviceAlert } from "@/lib/auth/new-device-alert";
import { issueLoginChallenge, verifyLoginChallenge } from "@/lib/auth/email-otp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { isEmailConfigured, sendOtpEmail } from "@/lib/email/smtp";

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

    const lockout = await checkAccountLockout(email);
    if (!lockout.allowed) {
      return new Response(
        JSON.stringify({ error: `Too many failed attempts. Try again in ${lockout.retryAfter} seconds.` }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(lockout.retryAfter) } }
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
              d.license_number,
              e.avatar_url,
              d.face_image_url
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
      const lockoutBucket = await recordFailedAttempt(email);
      if (!lockoutBucket.allowed && lockoutBucket.remaining === 0) {
        await raiseSecurityAlert(req, {
          type: "account_locked",
          employeeId: employee?.employee_id ?? null,
          details: { channel: "mobile" },
        });
      }
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

    // Mandatory email OTP, mirroring the Credentials provider in src/lib/auth.js.
    // There is no trusted-device equivalent here: a native client holds no
    // cookie, so every mobile sign-in presents a code. That is deliberate — the
    // drivers' phones are the least controlled devices in the fleet.
    const otpCode = body?.otpCode || body?.totpCode || body?.recoveryCode;

    // Fail closed before a code is issued. Driver accounts are the ones most
    // likely to still carry a placeholder address, so this branch is expected
    // to fire in practice, not just in theory.
    if (!isEmailConfigured() || !isDeliverableEmailAddress(employee.email)) {
      await writeAudit(req, null, {
        action: "mfa_unavailable",
        resource: "authentication",
        resourceId: employee.employee_id,
        newValues: {
          channel: "mobile",
          reason: isEmailConfigured() ? "undeliverable_address" : "smtp_unconfigured",
        },
      });
      return err("OTP_UNDELIVERABLE", 503);
    }

    // Mints a code and mails it. `ok: false` means no code exists to ask for, so
    // the caller must refuse; `ok: true` with a `delivery` of `cooldown` or
    // `break_glass_held` means a usable code is already outstanding and no mail
    // was sent on purpose.
    const sendNewCode = async () => {
      let issued;
      try {
        issued = await issueLoginChallenge({
          employeeId: employee.employee_id,
          ip: clientIp(req),
          userAgent: req.headers?.get?.("user-agent") || null,
        });
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (issued?.ok) {
        try {
          await sendOtpEmail({ to: employee.email, code: issued.code });
        } catch {
          await writeAudit(req, null, {
            action: "mfa_delivery_failure",
            resource: "authentication",
            resourceId: employee.employee_id,
            newValues: { channel: "mobile" },
          });
          return { ok: false, reason: "delivery_failed" };
        }
        return { ok: true, delivery: "sent" };
      }
      // An administrator-issued emergency code is never mailed over: the person
      // holding it is the one who cannot receive the email.
      if (issued?.reason === "break_glass_held" || issued?.reason === "cooldown") {
        return { ok: true, delivery: issued.reason };
      }
      return { ok: false, reason: "unavailable" };
    };

    if (!otpCode) {
      // Also the resend path: the client re-submits. It only ever runs after the
      // password verified, so no code reaches an unauthenticated caller.
      const delivery = await sendNewCode();
      if (!delivery.ok) return err("MFA_UNAVAILABLE", 503);
      await writeAudit(req, null, {
        action: "mfa_required",
        resource: "authentication",
        resourceId: employee.employee_id,
        newValues: { channel: "mobile", delivery: delivery.delivery },
      });
      return err("MFA_REQUIRED", 401);
    }

    const [otpIpBucket, otpAccountBucket] = await Promise.all([
      rateLimit(`otp-mobile-login:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`otp-mobile-login:account:${employee.employee_id}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!otpIpBucket.allowed || !otpAccountBucket.allowed) {
      return err("Too many verification attempts. Try again in a minute.", 429);
    }

    let factor;
    try {
      factor = await verifyLoginChallenge({
        employeeId: employee.employee_id,
        authVersion: employee.auth_version,
        code: otpCode,
      });
    } catch {
      return err("MFA_UNAVAILABLE", 503);
    }
    if (!factor.ok) {
      // An expired or superseded code is not a wrong code: send a fresh one and
      // ask again instead of spending an attempt on the clock.
      if (factor.reason === "expired" || factor.reason === "stale") {
        const delivery = await sendNewCode();
        if (!delivery.ok) return err("MFA_UNAVAILABLE", 503);
        await writeAudit(req, null, {
          action: "mfa_required",
          resource: "authentication",
          resourceId: employee.employee_id,
          newValues: { channel: "mobile", delivery: delivery.delivery },
        });
        return err("MFA_REQUIRED", 401);
      }
      await writeAudit(req, null, {
        action: "mfa_failure",
        resource: "authentication",
        resourceId: employee.employee_id,
        newValues: { channel: "mobile", reason: factor.reason },
      });
      return err("MFA_INVALID", 401);
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

    await clearAccountLockout(email);

    // Before the audit row below, so this sign-in cannot count as its own
    // precedent. Best-effort — it never throws and never blocks the login.
    //
    // Note the mobile channel collapses every phone to one device label (see
    // new-device-alert.js), so in practice a driver is alerted at most once,
    // on their first mobile sign-in. This is a web-strength control.
    await recordNewDeviceAlert({
      employee,
      userAgent: req.headers?.get?.("user-agent") || null,
      kind: "mobile",
    });

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
        avatarUrl: employee.face_image_url || employee.avatar_url || null,
      },
    });
  } catch (e) {
    return handleError(e, { req });
  }
}
