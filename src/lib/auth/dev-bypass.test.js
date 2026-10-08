import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDevOtpBypassEnabled } from "./dev-bypass";

describe("isDevOtpBypassEnabled", () => {
  it("returns true only for DEV_BYPASS_OTP=1 outside production", () => {
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "1", NODE_ENV: "development" })).toBe(true);
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "1", NODE_ENV: "test" })).toBe(true);
  });

  it("returns false without the flag", () => {
    expect(isDevOtpBypassEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "0", NODE_ENV: "development" })).toBe(false);
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "true", NODE_ENV: "development" })).toBe(false);
  });

  it("is inert in production even with the flag set", () => {
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "1", NODE_ENV: "production" })).toBe(false);
  });
});

it("auth.js gates the bypass behind isDevOtpBypassEnabled", () => {
  const src = readFileSync("src/lib/auth.js", "utf8");
  expect(src).toContain("isDevOtpBypassEnabled");
  expect(src).toContain("mfa_bypassed_dev");
});
