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

  it("uses a 30-day HttpOnly cookie and expires it explicitly on revoke", () => {
    expect(trustedDeviceCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: TRUSTED_DEVICE_TTL_SECONDS,
    });
    expect(trustedDeviceCookieOptions(0)).toMatchObject({ maxAge: 0, expires: new Date(0) });
  });

  it("keeps trusted-device bypass outside TOTP consumption", () => {
    const authSource = readFileSync(new URL("../auth.js", import.meta.url), "utf8");
    const consumeIndex = authSource.indexOf("consumeFactor(tx, employee.employee_id, factorCode)");
    const trustedGuardIndex = authSource.lastIndexOf("if (!trustedDevice) {", consumeIndex);

    expect(consumeIndex).toBeGreaterThan(-1);
    expect(trustedGuardIndex).toBeGreaterThan(-1);
    expect(authSource.slice(trustedGuardIndex, consumeIndex)).toContain("if (!trustedDevice)");
  });
});
