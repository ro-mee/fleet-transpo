import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { query } from "@/lib/db";
import { getSecurityPolicy } from "@/services/security-policy.service";

// Mints a fresh NextAuth session cookie for a brand-new web_sessions row.
//
// Used by the forced first-login password change (rotate-and-stay): the
// change-password transaction revokes EVERY session for the employee —
// including the one that posted the form — so the response itself carries
// the replacement. Signing in a second time would ask an employee who just
// proved both factors to prove them again for no security gain; the
// auth_version bump already invalidated anything that held the old token.
//
// The cookie shape must match what NextAuth's own credentials login writes
// (name field, Path=/ HttpOnly SameSite=Lax, __Secure- prefix in production) or
// the session would decode differently depending on how the user signed in.
// `maxAge` follows the configured absolute session lifetime so both paths mint
// the same cookie for the same policy.

export function sessionCookieName(env = process.env) {
  return env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

export async function mintRotatedSession({ employee, ip, userAgent }) {
  // Read before the INSERT: this mints a NEW session row, so it takes the
  // policy as it stands now, not the one the revoked session was created under.
  const policy = await getSecurityPolicy();
  const sessionId = randomUUID();
  await query(
    `INSERT INTO web_sessions
       (session_id, employee_id, expires_at, ip_address, user_agent, idle_timeout_seconds)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL, $4, $5, $6)`,
    [sessionId, employee.employeeId, policy.absoluteTtlSeconds, ip || null, userAgent || null, policy.idleTimeoutSeconds]
  );

  const token = {
    name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
    email: employee.email,
    picture: null,
    sub: String(employee.employeeId),
    role: employee.role,
    employeeId: employee.employeeId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    position: employee.position ?? null,
    status: employee.status,
    driverStatus: employee.driverStatus ?? null,
    avatarUrl: employee.avatarUrl ?? null,
    authVersion: employee.authVersion,
    sessionId,
    mustChangePassword: false,
  };

  const encoded = await encode({
    token,
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: policy.absoluteTtlSeconds,
  });

  const attrs = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${policy.absoluteTtlSeconds}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ];
  return {
    cookie: `${sessionCookieName()}=${encoded}; ${attrs.join("; ")}`,
    sessionId,
    token,
  };
}
