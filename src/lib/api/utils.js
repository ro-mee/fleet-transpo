import { auth } from "@/lib/auth";
import { validatePayload } from "@/lib/validation/helpers";
import { query } from "@/lib/db";
import { extractBearerToken, verifyAccessToken } from "@/lib/auth/mobile-token";

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
      throw new AuthError("Invalid or expired token", 401);
    }
    return {
      user: {
        employeeId: claims.employeeId,
        role: claims.role,
        driverId: claims.driverId,
      },
      via: "bearer",
    };
  }

  const session = await auth();
  if (!session?.user) {
    throw new AuthError("Unauthorized", 401);
  }
  return {
    ...session,
    user: { ...session.user, driverId: await resolveDriverId(session.user) },
    via: "session",
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
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function parseBody(req) {
  try {
    return await req.json();
  } catch {
    throw new AuthError("Invalid JSON body", 400);
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
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
