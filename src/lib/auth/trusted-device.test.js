import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_SECONDS,
  createTrustedDeviceToken,
  hashTrustedDeviceToken,
  trustedDeviceCookieOptions,
  trustedDeviceTokenFromCookieHeader,
} from "./trusted-device";

describe("trusted web device tokens", () => {
  it("creates opaque 256-bit tokens and stores only fixed-length hashes", () => {
    const token = createTrustedDeviceToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashTrustedDeviceToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTrustedDeviceToken(token)).not.toBe(token);
  });

  it("accepts only the named cookie and rejects malformed values", () => {
    const token = createTrustedDeviceToken();

    expect(trustedDeviceTokenFromCookieHeader(`other=value; ${TRUSTED_DEVICE_COOKIE}=${token}`)).toBe(token);
    expect(trustedDeviceTokenFromCookieHeader(`${TRUSTED_DEVICE_COOKIE}=short`)).toBeNull();
    expect(trustedDeviceTokenFromCookieHeader("other=value")).toBeNull();
  });

  it("uses a 7-day HttpOnly cookie and expires it explicitly on revoke", () => {
    expect(TRUSTED_DEVICE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(trustedDeviceCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: TRUSTED_DEVICE_TTL_SECONDS,
    });
    expect(trustedDeviceCookieOptions(0)).toMatchObject({ maxAge: 0, expires: new Date(0) });
  });

  it("honours a remembered browser before any code is issued", () => {
    const authSource = readFileSync(new URL("../auth.js", import.meta.url), "utf8");
    // The bypass must be resolved before the challenge is minted, or a trusted
    // browser would be mailed a code it does not need — and, worse, an SMTP
    // outage would sign out devices that had already proved themselves.
    const issueIndex = authSource.indexOf("await issueLoginChallenge({");
    const trustedGuardIndex = authSource.indexOf("if (!trustedDevice) {");

    expect(issueIndex).toBeGreaterThan(-1);
    expect(trustedGuardIndex).toBeGreaterThan(-1);
    expect(trustedGuardIndex).toBeLessThan(issueIndex);
    // And it is still checked *after* the password, so the cookie alone is never
    // sufficient to start a session.
    expect(authSource.indexOf("bcrypt.compare")).toBeLessThan(trustedGuardIndex);
  });

  it("keys the bypass to auth_version, so a credential change retires it", () => {
    const authSource = readFileSync(new URL("../auth.js", import.meta.url), "utf8");
    expect(authSource).toMatch(/AND auth_version = \$3[\s\S]{0,260}employee\.auth_version/);
  });
});
