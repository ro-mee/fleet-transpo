import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getAdminClient, query, withTransaction } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { consumeFactor } from "@/lib/auth/mfa";
import { WEB_SESSION_TTL_SECONDS } from "@/lib/auth/sessions";

export const authOptions = {
  providers: [
    Credentials({
      async authorize(credentials, req) {
        const email = credentials?.email;
        const password = credentials?.password;
        const factorCode = credentials?.totpCode || credentials?.recoveryCode;
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

        const supabase = getAdminClient();
        const { data: employee, error } = await supabase
          .from("employees")
          .select("employee_id, email, password_hash, first_name, last_name, position, status, auth_version, roles(role_name)")
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
          return null;
        }

        let mfaRows;
        try {
          ({ rows: mfaRows } = await query(
            `SELECT enabled_at FROM employee_mfa WHERE employee_id = $1 LIMIT 1`,
            [employee.employee_id]
          ));
        } catch {
          throw new Error("MFA_UNAVAILABLE");
        }
        if (mfaRows[0]?.enabled_at) {
          if (!factorCode) {
            await writeAudit(auditReq, null, {
              action: "mfa_required",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: { channel: "web" },
            });
            throw new Error("MFA_REQUIRED");
          }
          const [mfaIpBucket, mfaAccountBucket] = await Promise.all([
            rateLimit(`mfa-login:ip:${ip}`, { limit: 5, windowMs: 60_000 }),
            rateLimit(`mfa-login:account:${employee.employee_id}`, { limit: 5, windowMs: 60_000 }),
          ]);
          if (!mfaIpBucket.allowed || !mfaAccountBucket.allowed) {
            throw new Error("Too many verification attempts. Please try again in a minute.");
          }
          let factor;
          try {
            factor = await withTransaction((tx) => consumeFactor(tx, employee.employee_id, factorCode));
          } catch {
            throw new Error("MFA_UNAVAILABLE");
          }
          if (!factor.ok) {
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
        if (employee.roles?.role_name === "driver") {
          const { data: driverData } = await supabase
            .from("drivers")
            .select("driver_status")
            .eq("employee_id", employee.employee_id)
            .maybeSingle();
          driverStatus = driverData?.driver_status || null;
        }

        const sessionId = randomUUID();
        const userAgent = auditReq.headers.get("user-agent") || null;
        try {
          await query(
            `INSERT INTO web_sessions
               (session_id, employee_id, expires_at, ip_address, user_agent)
             VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL, $4, $5)`,
            [sessionId, employee.employee_id, WEB_SESSION_TTL_SECONDS, ip, userAgent]
          );
        } catch {
          throw new Error("Unable to start a secure session.");
        }

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
          role: employee.roles?.role_name,
          employeeId: employee.employee_id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          position: employee.position,
          status: employee.status,
          driverStatus,
          authVersion: employee.auth_version,
          sessionId,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.employeeId = user.employeeId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.position = user.position;
        token.status = user.status;
        token.driverStatus = user.driverStatus;
        token.authVersion = user.authVersion;
        token.sessionId = user.sessionId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.employeeId = token.employeeId;
      session.user.firstName = token.firstName;
      session.user.lastName = token.lastName;
      session.user.position = token.position;
      session.user.status = token.status;
      session.user.driverStatus = token.driverStatus;
      session.user.authVersion = token.authVersion;
      session.user.sessionId = token.sessionId;
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
