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
  OTP_ATTEMPTS_LEFT_PREFIX,
  OTP_CODE_DIGITS,
  OTP_LOCKOUT_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_STRIKE_PREFIX,
  OTP_TTL_SECONDS,
  maskEmailAddress,
  isEmailLike,
  formatCountdown,
  formatLockWait,
  parseOtpAttemptsLeft,
  parseOtpLock,
  parseOtpStrike,
  sanitizeOtpInput,
} from "./otp";
import {
  OTP_CODE_DIGITS as SERVER_DIGITS,
  OTP_TTL_SECONDS as SERVER_TTL,
  OTP_RESEND_COOLDOWN_SECONDS as SERVER_COOLDOWN,
  OTP_LOCKOUT_LIMIT as SERVER_LOCKOUT_LIMIT,
  OTP_MAX_ATTEMPTS as SERVER_MAX_ATTEMPTS,
  formatLockWait as serverFormatLockWait,
  maskEmailAddress as serverMask,
  parseOtpAttemptsLeft as serverParseOtpAttemptsLeft,
  parseOtpLock as serverParseOtpLock,
  parseOtpStrike as serverParseOtpStrike,
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

  it("attempt ceiling matches the server challenge", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(SERVER_MAX_ATTEMPTS);
  });

  it("lockout limit matches the server freeze", () => {
    expect(OTP_LOCKOUT_LIMIT).toBe(SERVER_LOCKOUT_LIMIT);
  });

  it("attempts-left prefix matches the server wire token", () => {
    expect(OTP_ATTEMPTS_LEFT_PREFIX).toBe("OTP_ATTEMPTS_LEFT:");
  });

  it("strike prefix matches the server wire token", () => {
    expect(OTP_STRIKE_PREFIX).toBe("OTP_STRIKE:");
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

describe("OTP_LOCKED token mirrors", () => {
  it("parses the same token the server sends, like the mask pins", () => {
    expect(parseOtpLock("OTP_LOCKED:900")).toBe(900);
    expect(parseOtpLock("OTP_LOCKED:900")).toBe(serverParseOtpLock("OTP_LOCKED:900"));
    expect(parseOtpLock("MFA_INVALID")).toBeNull();
    expect(parseOtpLock("MFA_INVALID")).toBe(serverParseOtpLock("MFA_INVALID"));
    expect(parseOtpLock(null)).toBe(serverParseOtpLock(null));
    expect(parseOtpLock("OTP_LOCKED:abc")).toBe(serverParseOtpLock("OTP_LOCKED:abc"));
  });

  it("formats the wait exactly like the server copy helper", () => {
    for (const secs of [1, 45, 60, 420, 900]) {
      expect(formatLockWait(secs)).toBe(serverFormatLockWait(secs));
    }
    expect(formatLockWait(420)).toBe("7 minutes");
    expect(formatLockWait(45)).toBe("45 seconds");
  });
});

describe("OTP_ATTEMPTS_LEFT token mirrors", () => {
  it("parses the same token the server sends, like the lock mirrors", () => {
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:4")).toBe(4);
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:4")).toBe(serverParseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:4"));
    for (const bad of [
      "OTP_ATTEMPTS_LEFT:0",
      "OTP_ATTEMPTS_LEFT:6",
      "OTP_ATTEMPTS_LEFT:abc",
      "OTP_STRIKE:2",
      "MFA_INVALID",
      null,
    ]) {
      expect(parseOtpAttemptsLeft(bad)).toBeNull();
      expect(parseOtpAttemptsLeft(bad)).toBe(serverParseOtpAttemptsLeft(bad));
    }
  });
});

describe("OTP_STRIKE token mirrors", () => {
  it("parses the same token the server sends, like the lock mirrors", () => {
    expect(parseOtpStrike("OTP_STRIKE:2")).toBe(2);
    expect(parseOtpStrike("OTP_STRIKE:2")).toBe(serverParseOtpStrike("OTP_STRIKE:2"));
    for (const bad of ["OTP_STRIKE:0", "OTP_STRIKE:4", "OTP_STRIKE:abc", "OTP_ATTEMPTS_LEFT:2", null]) {
      expect(parseOtpStrike(bad)).toBeNull();
      expect(parseOtpStrike(bad)).toBe(serverParseOtpStrike(bad));
    }
  });
});

describe("attempts and strike parser parity table", () => {
  const ATTEMPTS_CASES = [
    ["OTP_ATTEMPTS_LEFT:5", 5],
    ["OTP_ATTEMPTS_LEFT:4", 4],
    ["OTP_ATTEMPTS_LEFT:1", 1],
    ["OTP_ATTEMPTS_LEFT:0", null],
    ["OTP_ATTEMPTS_LEFT:6", null],
    ["OTP_ATTEMPTS_LEFT:1.5", null],
    ["OTP_ATTEMPTS_LEFT:", null],
    ["OTP_ATTEMPTS_LEFT", null],
    ["OTP_STRIKE:3", null],
    ["MFA_INVALID", null],
    ["", null],
    [null, null],
    [undefined, null],
    [4, null],
  ];

  const STRIKE_CASES = [
    ["OTP_STRIKE:3", 3],
    ["OTP_STRIKE:2", 2],
    ["OTP_STRIKE:1", 1],
    ["OTP_STRIKE:0", null],
    ["OTP_STRIKE:4", null],
    ["OTP_STRIKE:1.5", null],
    ["OTP_STRIKE:", null],
    ["OTP_STRIKE", null],
    ["OTP_ATTEMPTS_LEFT:2", null],
    ["2", null],
    ["", null],
    [null, null],
    [undefined, null],
    [3, null],
  ];

  it("pins boundaries and non-integers, and matches the server on every attempts input", () => {
    for (const [input, expected] of ATTEMPTS_CASES) {
      expect(parseOtpAttemptsLeft(input)).toBe(expected);
      expect(parseOtpAttemptsLeft(input)).toBe(serverParseOtpAttemptsLeft(input));
    }
  });

  it("pins boundaries and non-integers, and matches the server on every strike input", () => {
    for (const [input, expected] of STRIKE_CASES) {
      expect(parseOtpStrike(input)).toBe(expected);
      expect(parseOtpStrike(input)).toBe(serverParseOtpStrike(input));
    }
  });
});
