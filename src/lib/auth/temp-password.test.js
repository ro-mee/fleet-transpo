import { describe, expect, it } from "vitest";
import { isPassword } from "@/lib/validation/index";
import {
  generateTempPassword,
  tempPasswordExpiry,
  TEMP_PASSWORD_TTL_DAYS,
  TEMP_PASSWORD_TTL_MS,
} from "./temp-password";

describe("TEMP_PASSWORD_TTL", () => {
  it("is 7 days", () => {
    expect(TEMP_PASSWORD_TTL_DAYS).toBe(7);
    expect(TEMP_PASSWORD_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("generateTempPassword", () => {
  it("always satisfies the password policy", () => {
    for (let i = 0; i < 500; i++) {
      expect(isPassword(generateTempPassword())).toBe(true);
    }
  });

  it("is 16 characters by default and contains every character class", () => {
    const password = generateTempPassword();
    expect(password).toHaveLength(16);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("stays within the bcrypt 72-byte ceiling", () => {
    for (let i = 0; i < 100; i++) {
      expect(Buffer.byteLength(generateTempPassword(), "utf8")).toBeLessThanOrEqual(72);
    }
  });

  it("does not repeat itself across generations", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generateTempPassword());
    expect(seen.size).toBe(500);
  });

  it("honors an explicit length of at least 8", () => {
    expect(generateTempPassword(8)).toHaveLength(8);
    expect(isPassword(generateTempPassword(8))).toBe(true);
    expect(() => generateTempPassword(7)).toThrow();
  });

  it("avoids characters that need escaping in email HTML", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateTempPassword()).not.toMatch(/[<>&"'`]/);
    }
  });
});

describe("tempPasswordExpiry", () => {
  it("returns a Date 7 days from now", () => {
    const before = Date.now();
    const expiry = tempPasswordExpiry();
    const after = Date.now();
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + TEMP_PASSWORD_TTL_MS);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + TEMP_PASSWORD_TTL_MS);
  });

  it("accepts an explicit anchor", () => {
    const anchor = new Date("2026-09-23T00:00:00Z");
    expect(tempPasswordExpiry(anchor).getTime()).toBe(anchor.getTime() + TEMP_PASSWORD_TTL_MS);
  });
});
