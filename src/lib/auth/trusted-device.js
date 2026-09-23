import { createHash, randomBytes } from "node:crypto";

/**
 * How long a browser may skip the emailed code.
 *
 * Shortened from 30 days when the second factor moved to email OTP. The 30-day
 * value was chosen against TOTP, where the thing being skipped lived on the
 * user's own device; an emailed code protects a mailbox, so the window it can
 * be skipped for should be a working week, not a month. A stolen laptop is
 * therefore worth at most 7 days of access, and a password change still ends
 * it immediately via `auth_version`.
 *
 * This is the reason the honest claim is "MFA at first sign-in per device",
 * not "MFA on every sign-in" — see Authentication.md.
 */
export const TRUSTED_DEVICE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const TRUSTED_DEVICE_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-fleetops-trusted-device"
    : "fleetops-trusted-device";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createTrustedDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export function normalizeTrustedDeviceToken(token) {
  return typeof token === "string" && TOKEN_PATTERN.test(token) ? token : null;
}

export function hashTrustedDeviceToken(token) {
  const normalized = normalizeTrustedDeviceToken(token);
  return normalized ? createHash("sha256").update(normalized, "utf8").digest("hex") : null;
}

export function trustedDeviceTokenFromCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== "string") return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== TRUSTED_DEVICE_COOKIE) continue;
    return normalizeTrustedDeviceToken(part.slice(separator + 1).trim());
  }

  return null;
}

export function trustedDeviceCookieOptions(maxAge = TRUSTED_DEVICE_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
    priority: "high",
    ...(maxAge === 0 ? { expires: new Date(0) } : {}),
  };
}
