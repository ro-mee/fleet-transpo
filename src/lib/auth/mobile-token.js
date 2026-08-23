import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Bearer-token auth for the mobile app.
 *
 * The web app authenticates with an httpOnly NextAuth cookie, which a native
 * client cannot hold. Mobile gets JWTs instead, signed with MOBILE_JWT_SECRET
 * so a leak of one signing key cannot forge BOTH web sessions and mobile
 * tokens (audit finding S6). MOBILE_JWT_SECRET falls back to NEXTAUTH_SECRET
 * (with a loud warning) so existing single-secret deployments keep working;
 * set a distinct value in production.
 *
 * Access tokens are stateless: 15 minutes, verified by signature alone, no DB
 * hit on every request. Refresh tokens are long-lived, so they are recorded in
 * mobile_refresh_tokens (by hash) and can be revoked.
 */

const ISSUER = "fleetops";
const ACCESS_AUDIENCE = "fleetops-mobile-access";
const REFRESH_AUDIENCE = "fleetops-mobile-refresh";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

let cachedKey;

function getSigningKey() {
  if (typeof window !== "undefined") {
    throw new Error("mobile-token is server-only.");
  }
  if (!cachedKey) {
    let secret = process.env.MOBILE_JWT_SECRET;
    if (!secret) {
      console.warn(
        "MOBILE_JWT_SECRET is not set — mobile tokens are falling back to NEXTAUTH_SECRET. Set a distinct MOBILE_JWT_SECRET so a leaked key cannot forge both token systems."
      );
      secret = process.env.NEXTAUTH_SECRET;
    }
    if (!secret) {
      throw new Error("MOBILE_JWT_SECRET (or NEXTAUTH_SECRET fallback) is not set.");
    }
    cachedKey = new TextEncoder().encode(secret);
  }
  return cachedKey;
}

/** Refresh tokens are stored as a hash, never in plaintext. */
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * @param {{ employeeId: number, role: string, driverId: number | null }} identity
 */
export async function signAccessToken({ employeeId, role, driverId }) {
  return new SignJWT({ role, driverId: driverId ?? null })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(employeeId))
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

/**
 * The jti is returned alongside the token so the caller can log it; the row is
 * keyed on the hash of the whole token, not the jti.
 */
export async function signRefreshToken({ employeeId }) {
  const jti = randomUUID();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(employeeId))
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience(REFRESH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(getSigningKey());
  return { token, jti };
}

/**
 * Resolves to the access-token claims, or null when the token is absent,
 * malformed, expired, tampered with, or is a refresh token being replayed as an
 * access token (the audience check catches that).
 */
export async function verifyAccessToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      algorithms: ["HS256"],
    });
    const employeeId = Number(payload.sub);
    if (!Number.isInteger(employeeId)) return null;
    return {
      employeeId,
      role: payload.role ?? null,
      driverId: payload.driverId ?? null,
    };
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
      audience: REFRESH_AUDIENCE,
      algorithms: ["HS256"],
    });
    const employeeId = Number(payload.sub);
    if (!Number.isInteger(employeeId)) return null;
    return { employeeId, jti: payload.jti ?? null, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

/** Reads the raw token out of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(req) {
  const header = req?.headers?.get?.("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim() || null;
}
