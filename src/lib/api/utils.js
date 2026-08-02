import { auth } from "@/lib/auth";
import { validatePayload } from "@/lib/validation/helpers";

export async function requireAuth(req, allowedRoles = ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]) {
  const session = await auth();
  if (!session?.user) {
    throw new AuthError("Unauthorized", 401);
  }
  const role = session.user.role;
  if (!allowedRoles.includes("*") && !allowedRoles.includes(role)) {
    throw new AuthError(`Role '${role}' is not permitted`, 403);
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
  return Response.json({ error: error.message || "Internal server error" }, { status: 500 });
}
