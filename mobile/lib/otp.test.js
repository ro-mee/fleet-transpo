/**
 * Mobile OTP helper tests (lib/otp.js).
 *
 * Pins the client mirrors to the server contract
 * (`src/lib/auth/otp-policy.js`): digit count, TTL and resend cooldown must
 * agree, or a code the screen accepts could never verify (or one it rejects
 * would). Mask/format/sanitize behavior is pinned so the verification copy
 * never leaks a full address and paste handling stays numeric.
 */
import { describe, it, expect } from "vitest";
import {
  OTP_CODE_DIGITS,
  OTP_TTL_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  maskEmailAddress,
  isEmailLike,
  formatCountdown,
  sanitizeOtpInput,
} from "./otp";
import {
  OTP_CODE_DIGITS as SERVER_DIGITS,
  OTP_TTL_SECONDS as SERVER_TTL,
  OTP_RESEND_COOLDOWN_SECONDS as SERVER_COOLDOWN,
  maskEmailAddress as serverMask,
} from "../../src/lib/auth/otp-policy.js";

describe("OTP contract mirrors", () => {
  it("digit count matches the server challenge", () => {
    expect(OTP_CODE_DIGITS).toBe(SERVER_DIGITS);
  });

  it("TTL matches the server expiry", () => {
    expect(OTP_TTL_SECONDS).toBe(SERVER_TTL);
  });

  it("resend cooldown matches the server gate", () => {
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(SERVER_COOLDOWN);
  });

  it("masking matches the server for the same address", () => {
    for (const address of ["jane.doe@example.com", "a@gmail.com", "DRV-001", ""]) {
      expect(maskEmailAddress(address)).toBe(serverMask(address));
    }
  });
});

describe("maskEmailAddress", () => {
  it("keeps the domain legible and hides the local part", () => {
    expect(maskEmailAddress("jane.doe@example.com")).toBe("ja••••••@example.com");
  });

  it("returns non-email identifiers untouched for generic copy", () => {
    expect(maskEmailAddress("DRV-001")).toBe("DRV-001");
  });
});

describe("isEmailLike", () => {
  it("accepts real addresses and rejects driver IDs", () => {
    expect(isEmailLike("driver@fleet.com")).toBe(true);
    expect(isEmailLike("DRV-001")).toBe(false);
    expect(isEmailLike("")).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("renders MM:SS with clamping", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(59.2)).toBe("01:00");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});

describe("sanitizeOtpInput", () => {
  it("keeps digits only, capped at the code length", () => {
    expect(sanitizeOtpInput("12a34b567890")).toBe("123456");
    expect(sanitizeOtpInput(null)).toBe("");
  });
});
