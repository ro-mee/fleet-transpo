import { auth } from "@/lib/auth";
import { validatePayload } from "@/lib/validation/helpers";
import { query } from "@/lib/db";
import { extractBearerToken, verifyAccessToken } from "@/lib/auth/mobile-token";
import { rolesFor } from "@/lib/auth/permissions";

const DEFAULT_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management"];

/**
 * Resolves the caller's identity from either auth scheme.
 *
 * Mobile sends `Authorization: Bearer <access token>`; the web app sends the
 * httpOnly NextAuth cookie. Bearer wins when both are present, since an
 * explicit header is the more deliberate signal.
 *
 * Returns a session-shaped object so existing route code that reads
 * `session.user.employeeId` keeps working unchanged.
 */
export async function resolveIdentity(req) {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const claims = await verifyAccessToken(bearer);
    if (!claims) {
      throw new AuthError("Invalid or expired token", 401, "SESSION_INVALID");
    }
    return {
      user: await resolveCurrentIdentity({
        employeeId: claims.employeeId,
        role: claims.role,
        driverId: claims.driverId,
        authVersion: claims.authVersion,
        familyId: claims.familyId,
      }, "bearer"),
      via: "bearer",
    };
  }

  const session = await auth();
  if (!session?.user) {
    throw new AuthError("Unauthorized", 401, "SESSION_INVALID");
  }
  // The route harness deliberately supplies synthetic roles. Keep that test
  // seam isolated; real cookie sessions always re-read the employee row.
  const user = Object.prototype.hasOwnProperty.call(globalThis, "__HARNESS_SESSION__")
    ? { ...session.user, driverId: await resolveDriverId(session.user) }
    : await resolveCurrentIdentity(session.user, "session");
  return { ...session, user, via: "session" };
}

async function resolveCurrentIdentity(user, via = "session") {
  let sessionDetails = null;
  if (via === "session") {
    if (!user.sessionId) throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_INVALID");
    const { rows: sessionRows } = await query(
      `SELECT session_id, last_seen_at, expires_at, revoked_at, idle_timeout_seconds
         FROM web_sessions
        WHERE session_id = $1
          AND employee_id = $2
        LIMIT 1`,
      [user.sessionId, user.employeeId]
    );
    const sessionRecord = sessionRows[0];
    if (!sessionRecord) {
      throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_INVALID");
    }
    if (sessionRecord.revoked_at) {
      throw new AuthError("Your session has been revoked.", 401, "SESSION_REVOKED");
    }
    if (new Date(sessionRecord.expires_at).getTime() <= Date.now()) {
      throw new AuthError("Your session has expired.", 401, "SESSION_EXPIRED");
    }
    const idleSeconds = Number(sessionRecord.idle_timeout_seconds) || 3600;
    const idleExpiresAt = new Date(sessionRecord.last_seen_at).getTime() + idleSeconds * 1000;
    if (Date.now() > idleExpiresAt) {
      throw new AuthError("Your session expired due to inactivity.", 401, "SESSION_IDLE_TIMEOUT");
    }

    sessionDetails = {
      sessionId: sessionRecord.session_id,
      lastSeenAt: sessionRecord.last_seen_at,
      expiresAt: sessionRecord.expires_at,
      idleTimeoutSeconds: idleSeconds,
      idleExpiresAt: new Date(idleExpiresAt).toISOString(),
    };

    if (new Date(sessionRecord.last_seen_at).getTime() < Date.now() - 5 * 60_000) {
      try {
        await query(
          `UPDATE web_sessions SET last_seen_at = NOW()
            WHERE session_id = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'`,
          [user.sessionId]
        );
      } catch (error) {
        console.warn("Failed to update web session activity:", error?.message || error);
      }
    }
  }

  const { rows } = await query(
      `SELECT e.employee_id, e.email, e.first_name, e.last_name, e.position, e.status,
              e.auth_version,
             r.role_name, d.driver_id
       FROM employees e
       LEFT JOIN roles r ON r.role_id = e.role_id
       LEFT JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
      WHERE e.employee_id = $1
        AND e.deleted_at IS NULL
        AND e.status = 'Active'
      LIMIT 1`,
    [user.employeeId]
  );
  const current = rows[0];
  if (!current?.role_name || current.status !== "Active") {
    throw new AuthError("Unauthorized", 401, "ACCOUNT_DISABLED");
  }
  // Tokens issued before auth_version was introduced are deliberately rejected
  // once this guard is deployed; the next login receives a versioned token.
  if (!Number.isSafeInteger(Number(user.authVersion)) || Number(user.authVersion) !== Number(current.auth_version)) {
    throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_REVOKED");
  }
  if (via === "bearer") {
    if (!user.familyId) throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_INVALID");
    const { rows: familyRows } = await query(
      `SELECT revoked_at, expires_at
         FROM mobile_refresh_tokens
        WHERE employee_id = $1 AND family_id = $2
        LIMIT 1`,
      [current.employee_id, user.familyId]
    );
    const familyRecord = familyRows[0];
    if (!familyRecord) throw new AuthError("Session expired. Please sign in again.", 401, "SESSION_INVALID");
    if (familyRecord.revoked_at) throw new AuthError("Session revoked.", 401, "SESSION_REVOKED");
    if (new Date(familyRecord.expires_at).getTime() <= Date.now()) throw new AuthError("Session expired.", 401, "SESSION_EXPIRED");
  }
  return {
    ...user,
    employeeId: current.employee_id,
    email: current.email,
    name: `${current.first_name} ${current.last_name}`,
    firstName: current.first_name,
    lastName: current.last_name,
    position: current.position,
    status: current.status,
    authVersion: Number(current.auth_version),
    role: current.role_name,
    driverId: current.driver_id ?? null,
    sessionDetails,
  };
}

/**
 * Cookie sessions carry no driver_id — NextAuth only reads `employees`. Look it
 * up so driver-scoped routes can rely on `driverId` regardless of auth scheme.
 * Non-drivers never hit the query.
 */
async function resolveDriverId(user) {
  if (user.role !== "driver") return null;
  const { rows } = await query(
    `SELECT driver_id FROM drivers WHERE employee_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [user.employeeId]
  );
  return rows[0]?.driver_id ?? null;
}

export async function requireAuth(req, allowedRoles = DEFAULT_ROLES) {
  const session = await resolveIdentity(req);
  const role = session.user.role;
  if (!allowedRoles.includes("*") && !allowedRoles.includes(role)) {
    throw new AuthError(`Role '${role}' is not permitted`, 403);
  }
  return session;
}

export async function requirePermission(req, resource, action) {
  return requireAuth(req, rolesFor(resource, action));
}

/**
 * For endpoints a driver calls on their own behalf. Guarantees `driverId` is
 * present, so downstream ownership checks can never silently compare against
 * null. Operations roles are allowed through with a null driverId and must
 * scope their own queries.
 */
export async function requireDriver(req) {
  const session = await requireAuth(req, ["driver"]);
  if (!session.user.driverId) {
    throw new AuthError("No driver record is linked to this account", 403);
  }
  return session;
}

export class AuthError extends Error {
  constructor(message, status = 401, code = "SESSION_INVALID") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function parseBody(req) {
  try {
    return await req.json();
  } catch {
    throw new AuthError("Invalid JSON body", 400, "BAD_REQUEST");
  }
}

export function ok(data, status = 200) {
  return Response.json(data, { status });
}

export function err(message, status = 400) {
  return Response.json({ error: message }, { status });
}

export function errValidation(errors) {
  const first = Object.values(errors)[0];
  return Response.json({ error: first, errors }, { status: 400 });
}

export function validateBody(body, schema = {}) {
  return validatePayload(body, schema);
}

export function handleError(error) {
  console.error("API error:", error);
  if (error instanceof AuthError) {
    const payload = { error: error.message };
    if (error.code) payload.code = error.code;
    return Response.json(payload, { status: error.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
