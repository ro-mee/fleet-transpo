import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getAdminClient, query } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { issueLoginChallenge, verifyLoginChallenge } from "@/lib/auth/email-otp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { isEmailConfigured, sendOtpEmail } from "@/lib/email/smtp";
import { checkAccountLockout, recordFailedAttempt, clearAccountLockout, LOCKOUT_LIMIT } from "@/lib/auth/account-lockout";
import { raiseSecurityAlert } from "@/lib/auth/security-alerts";
import { recordNewDeviceAlert } from "@/lib/auth/new-device-alert";
import { WEB_SESSION_TTL_SECONDS, IDLE_TIMEOUT_SECONDS } from "@/lib/auth/sessions";
import { hashTrustedDeviceToken, trustedDeviceTokenFromCookieHeader } from "@/lib/auth/trusted-device";
import { signedUrlFor, isResolvableMediaRef } from "@/lib/storage/object-refs";
import { AVATAR_BUCKETS } from "@/lib/drivers/media";
import { normalizeRoleName } from "@/lib/auth/role-names";

export function isSafeAvatarUrl(url) {
  if (!url || typeof url !== "string") return false;
  // Strictly allow remote HTTP/HTTPS URLs under 512 characters.
  // Never allow base64 data: URLs in session cookies (causes HTTP 431 / 494 header overflow).
  return (url.startsWith("http://") || url.startsWith("https://")) && url.length <= 512;
}

export const authOptions = {
  providers: [
    Credentials({
      async authorize(credentials, req) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (!email || !password) return null;

        // Throttle login attempts per IP to blunt brute-force / credential
        // stuffing. 5 attempts per minute.
        const ip = clientIp({ headers: new Headers(req?.headers || {}) });
        const normalizedEmail = String(email).toLowerCase().trim();
        const [ipBucket, accountBucket] = await Promise.all([
          rateLimit(`login:ip:${ip}`, { limit: 5, windowMs: 60_000 }),
          rateLimit(`login:account:${normalizedEmail}`, { limit: 5, windowMs: 60_000 }),
        ]);
        if (!ipBucket.allowed || !accountBucket.allowed) {
          throw new Error("Too many login attempts. Please try again in a minute.");
        }

        const lockout = await checkAccountLockout(normalizedEmail);
        if (!lockout.allowed) {
          throw new Error(`ACCOUNT_LOCKED:${lockout.retryAfter}`);
        }

        const supabase = getAdminClient();
        const { data: employee, error } = await supabase
          .from("employees")
          .select("employee_id, email, password_hash, first_name, last_name, position, status, auth_version, must_change_password, temp_credential_expires_at, roles(role_name), avatar_url")
          .eq("email", normalizedEmail)
          .eq("status", "Active")
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;

        // Always spend the bcrypt work even when the account does not exist, so
        // the login endpoint does not expose an email-existence timing oracle.
        const valid = await bcrypt.compare(
          String(password),
          employee?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
        );
        const auditReq = { headers: new Headers(req?.headers || {}) };
        if (!employee || !valid) {
          await writeAudit(auditReq, null, {
            action: "login_failure",
            resource: "authentication",
            resourceId: employee?.employee_id,
            newValues: { channel: "web" },
          });
          const lockoutBucket = await recordFailedAttempt(normalizedEmail);
          if (!lockoutBucket.allowed && lockoutBucket.remaining === 0) {
            await raiseSecurityAlert(auditReq, {
              type: "account_locked",
              details: { channel: "web", failures: LOCKOUT_LIMIT, windowMinutes: 15 },
            });
          }
          return null;
        }

        // A temporary invite password dies on its own schedule even though the
        // hash still matches. Reject BEFORE any OTP is minted so no verification
        // email goes out for a credential that cannot be used. Thrown messages
        // reach the client (unlike `return null`, which becomes CredentialsSignin).
        if (
          employee.must_change_password &&
          employee.temp_credential_expires_at &&
          new Date(employee.temp_credential_expires_at).getTime() < Date.now()
        ) {
          throw new Error("TEMP_PASSWORD_EXPIRED");
        }

        // Email OTP is the only second factor and it is not optional: there is
        // no enrollment row to consult, no per-account switch and no bypass.
        // `employee_mfa` is retained for rollback but is no longer read, so an
        // account that never enrolled TOTP is now protected exactly like one
        // that did.
        //
        // `totpCode` is still accepted because the released web and mobile
        // clients send that field name; it carries an emailed code now.
        const otpCode =
          credentials?.otpCode || credentials?.totpCode || credentials?.recoveryCode;

        // A remembered browser is an independent credential this server issued
        // earlier, so it is honoured before mail is involved at all: an SMTP
        // outage must not sign out a device that already proved itself.
        let trustedDevice = false;
        if (!otpCode) {
          const trustedToken = trustedDeviceTokenFromCookieHeader(auditReq.headers.get("cookie"));
          if (trustedToken) {
            try {
              const trusted = await query(
                `UPDATE trusted_web_devices
                    SET last_used_at = NOW()
                  WHERE employee_id = $1
                    AND token_hash = $2
                    AND auth_version = $3
                    AND revoked_at IS NULL
                    AND expires_at > NOW()
                  RETURNING device_id`,
                [employee.employee_id, hashTrustedDeviceToken(trustedToken), employee.auth_version]
              );
              trustedDevice = Boolean(trusted.rows[0]);
            } catch {
              // A remembered-device lookup fails closed to normal OTP.
              trustedDevice = false;
            }
          }
        }

        if (!trustedDevice) {
          // Fail closed, before any code is issued. An undeliverable address is
          // not a factor, and "let this one through" would make the gate
          // decorative. A routable address that belongs to a stranger is worse
          // still, and no runtime check can tell the two apart — that question
          // belongs to `scripts/audit-otp-inbox-ownership.mjs`.
          if (!isEmailConfigured() || !isDeliverableEmailAddress(employee.email)) {
            await writeAudit(auditReq, null, {
              action: "mfa_unavailable",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: {
                channel: "web",
                reason: isEmailConfigured() ? "undeliverable_address" : "smtp_unconfigured",
              },
            });
            throw new Error("OTP_UNDELIVERABLE");
          }

          // Mints a code for this employee and mails it, reporting why when no
          // mail went out. It never returns the code itself, so there is no
          // path by which a caller receives one.
          const sendNewCode = async () => {
            let issued;
            try {
              issued = await issueLoginChallenge({
                employeeId: employee.employee_id,
                ip,
                userAgent: auditReq.headers.get("user-agent") || null,
              });
            } catch {
              throw new Error("MFA_UNAVAILABLE");
            }
            if (issued?.ok) {
              try {
                await sendOtpEmail({ to: employee.email, code: issued.code });
              } catch {
                await writeAudit(auditReq, null, {
                  action: "mfa_delivery_failure",
                  resource: "authentication",
                  resourceId: employee.employee_id,
                  newValues: { channel: "web" },
                });
                throw new Error("MFA_UNAVAILABLE");
              }
              return "sent";
            }
            // An administrator-issued emergency code is deliberately NOT
            // replaced: the person holding it cannot receive the email, so
            // mailing over it would destroy their only way in.
            if (issued?.reason === "break_glass_held") return "break_glass_held";
            if (issued?.reason === "cooldown") return "cooldown";
            throw new Error("MFA_UNAVAILABLE");
          };

          // The audit fires whether or not mail actually left: the question it
          // answers is "a second factor was demanded here", not "was it read".
          const requireCode = async (delivery) => {
            await writeAudit(auditReq, null, {
              action: "mfa_required",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: { channel: "web", delivery },
            });
            throw new Error("MFA_REQUIRED");
          };

          // No code supplied. This branch is also the resend path — the client
          // re-submits the form. It only ever runs after the password verified,
          // which is why no code is ever sent to an unauthenticated caller and
          // there is no enumeration surface to defend.
          if (!otpCode) {
            await requireCode(await sendNewCode());
          }

          const [otpIpBucket, otpAccountBucket] = await Promise.all([
            rateLimit(`otp-login:ip:${ip}`, { limit: 5, windowMs: 60_000 }),
            rateLimit(`otp-login:account:${employee.employee_id}`, { limit: 5, windowMs: 60_000 }),
          ]);
          if (!otpIpBucket.allowed || !otpAccountBucket.allowed) {
            throw new Error("Too many verification attempts. Please try again in a minute.");
          }

          let factor;
          try {
            factor = await verifyLoginChallenge({
              employeeId: employee.employee_id,
              authVersion: employee.auth_version,
              code: otpCode,
            });
          } catch {
            throw new Error("MFA_UNAVAILABLE");
          }

          if (!factor.ok) {
            // A code that ran out of time is not a wrong code, and neither is
            // one minted before a credential changed. Both are answered by
            // sending a fresh code rather than by spending an attempt on the
            // clock.
            if (factor.reason === "expired" || factor.reason === "stale") {
              await requireCode(await sendNewCode());
            }
            await writeAudit(auditReq, null, {
              action: "mfa_failure",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: { channel: "web", reason: factor.reason },
            });
            throw new Error("MFA_INVALID");
          }
        }

        let driverStatus = null;
        let driverFaceImageUrl = null;
        if (employee.roles?.role_name === "driver") {
          const { data: driverData } = await supabase
            .from("drivers")
            .select("driver_status, face_image_url")
            .eq("employee_id", employee.employee_id)
            .maybeSingle();
          driverStatus = driverData?.driver_status || null;
          driverFaceImageUrl = driverData?.face_image_url || null;
        }

        // `drivers.face_image_url` and `employees.avatar_url` hold object keys
        // now, and a key is not renderable — 413-char signed URLs are, measured
        // against the live project, so they fit the 512 cap below.
        //
        // Resolve BEFORE the guard, because the guard is what would reject a key:
        // `isSafeAvatarUrl` requires an http(s) string, so an unresolved key going
        // in would come back out as a silently blank avatar on every page. Only
        // refs this module owns are resolved; an avatar that is an ordinary
        // external URL is left exactly as it was.
        const candidateAvatar = driverFaceImageUrl || employee.avatar_url || null;
        const resolvedAvatar = isResolvableMediaRef(candidateAvatar, AVATAR_BUCKETS)
          ? await signedUrlFor(AVATAR_BUCKETS, candidateAvatar)
          : candidateAvatar;
        const avatarUrl = isSafeAvatarUrl(resolvedAvatar) ? resolvedAvatar : null;

        const sessionId = randomUUID();
        const userAgent = auditReq.headers.get("user-agent") || null;
        try {
          await query(
            `INSERT INTO web_sessions
               (session_id, employee_id, expires_at, ip_address, user_agent, idle_timeout_seconds)
             VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL, $4, $5, $6)`,
            [sessionId, employee.employee_id, WEB_SESSION_TTL_SECONDS, ip, userAgent, IDLE_TIMEOUT_SECONDS]
          );
        } catch {
          throw new Error("Unable to start a secure session.");
        }

        await clearAccountLockout(normalizedEmail);

        // Before the audit row below, so this sign-in cannot count as its own
        // precedent. Best-effort — it never throws and never blocks the login.
        await recordNewDeviceAlert({
          employee,
          userAgent,
          kind: "web",
        });

        await writeAudit(auditReq, null, {
          action: "login_success",
          resource: "authentication",
          resourceId: employee.employee_id,
          newValues: { channel: "web", session_recorded: true },
        });

        return {
          id: String(employee.employee_id),
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`,
          role: normalizeRoleName(employee.roles?.role_name),
          employeeId: employee.employee_id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          position: employee.position,
          status: employee.status,
          driverStatus,
          avatarUrl,
          image: avatarUrl,
          authVersion: employee.auth_version,
          sessionId,
          mustChangePassword: Boolean(employee.must_change_password),
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = normalizeRoleName(user.role);
        token.employeeId = user.employeeId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.position = user.position;
        token.status = user.status;
        token.driverStatus = user.driverStatus;
        token.avatarUrl = isSafeAvatarUrl(user.avatarUrl) ? user.avatarUrl : null;
        token.authVersion = user.authVersion;
        token.sessionId = user.sessionId;
        token.mustChangePassword = Boolean(user.mustChangePassword);
      }
      if (trigger === "update" && session?.avatarUrl !== undefined) {
        token.avatarUrl = isSafeAvatarUrl(session.avatarUrl) ? session.avatarUrl : null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = normalizeRoleName(token.role);
      session.user.employeeId = token.employeeId;
      session.user.firstName = token.firstName;
      session.user.lastName = token.lastName;
      session.user.position = token.position;
      session.user.status = token.status;
      session.user.driverStatus = token.driverStatus;
      session.user.avatarUrl = token.avatarUrl || null;
      session.user.image = token.avatarUrl || null;
      session.user.authVersion = token.authVersion;
      session.user.sessionId = token.sessionId;
      session.user.mustChangePassword = Boolean(token.mustChangePassword);
      return session;
    }
  },
  events: {
    async signOut({ token }) {
      if (!token?.sessionId) return;
      try {
        await query(
          `UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE session_id = $1`,
          [token.sessionId]
        );
      } catch (error) {
        console.warn("Failed to revoke web session:", error?.message || error);
      }
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    // Dashboard credentials should not remain valid for the framework's
    // 30-day default idle window.
    maxAge: 12 * 60 * 60,
  },
};

export async function auth() {
  const { getServerSession } = await import("next-auth");
  return getServerSession(authOptions);
}
