import { createHash, randomBytes } from "node:crypto";

export const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;
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
