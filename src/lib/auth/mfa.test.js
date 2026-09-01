import { describe, expect, it } from "vitest";
import { generateSecret } from "./mfa";

describe("MFA secret generation", () => {
  it("creates a base32 secret compatible with otpauth", () => {
    const secret = generateSecret();

    expect(secret).toMatch(/^[2-7A-Z]+=*$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });
});
