/**
 * Shared password-policy tests (password-validation.js).
 *
 * Pins the client policy to the server contract (`type: "password"` in
 * src/lib/validation/helpers.js): min 8 chars, lower + upper + number +
 * special, 72-byte bcrypt cap, new-must-differ, confirm-must-match. Both
 * driver credential screens consume these helpers, so a policy drift in one
 * place fails here instead of shipping as a server-rejected form.
 */
import { describe, it, expect } from "vitest";
import {
  passwordRequirementChecks,
  validateNewPassword,
  validateConfirmPassword,
} from "./password-validation";
// Direct import of the server contract: index.js is dependency-free (pure
// regex + constants), so the client test can pin itself to the exact
// enforcement the API routes apply (`type: "password"` in
// src/lib/validation/helpers.js → isPassword + isPasswordByteLengthAllowed).
import {
  isPassword as serverIsPassword,
  isPasswordByteLengthAllowed as serverIsByteLengthAllowed,
} from "../../src/lib/validation/index.js";

const GOOD = "Driver-2026!";

describe("passwordRequirementChecks", () => {
  it("marks every requirement valid for a compliant password", () => {
    const checks = passwordRequirementChecks(GOOD);
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => c.valid)).toBe(true);
  });

  it("flags each requirement independently", () => {
    const byKey = Object.fromEntries(
      passwordRequirementChecks("abcdefgh").map((c) => [c.key, c.valid])
    );
    expect(byKey).toEqual({
      length: true,
      lowercase: true,
      uppercase: false,
      number: false,
      special: false,
    });
  });

  it("tolerates missing input without throwing", () => {
    expect(passwordRequirementChecks().every((c) => !c.valid)).toBe(true);
    expect(passwordRequirementChecks(null).every((c) => !c.valid)).toBe(true);
  });
});

describe("validateNewPassword", () => {
  it("accepts a compliant password", () => {
    expect(validateNewPassword(GOOD)).toBeNull();
  });

  it("requires a value", () => {
    expect(validateNewPassword("")).toBe("New password is required.");
  });

  it("enforces minimum length first", () => {
    expect(validateNewPassword("Aa1!")).toBe("Password must be at least 8 characters.");
  });

  it("enforces each character class", () => {
    expect(validateNewPassword("driver-2026!")).toMatch(/uppercase/);
    expect(validateNewPassword("DRIVER-2026!")).toMatch(/lowercase/);
    expect(validateNewPassword("Driver-pass!")).toMatch(/number/);
    expect(validateNewPassword("Driver20261")).toMatch(/special/);
  });

  it("enforces the 72 UTF-8 byte bcrypt cap", () => {
    // 4-byte emoji count as 4 bytes each: 17 x U+1F600 = 68, plus "Aa1!" = 72.
    const atCap = `${"😀".repeat(17)}Aa1!`;
    expect(validateNewPassword(atCap)).toBeNull();
    expect(validateNewPassword(`${atCap}!`)).toMatch(/72/);
  });

  it("rejects a new password identical to the current one", () => {
    expect(validateNewPassword(GOOD, { currentPassword: GOOD })).toMatch(/different/);
    expect(validateNewPassword(GOOD, { currentPassword: "Other-2026!" })).toBeNull();
    // No current password (reset flow) never triggers the sameness rule.
    expect(validateNewPassword(GOOD)).toBeNull();
  });
});

describe("validateConfirmPassword", () => {
  it("requires confirmation and an exact match", () => {
    expect(validateConfirmPassword(GOOD, "")).toBe("Confirm password is required.");
    expect(validateConfirmPassword(GOOD, "Driver-2026?")).toBe("Passwords do not match.");
    expect(validateConfirmPassword(GOOD, GOOD)).toBeNull();
  });
});

describe("server parity (enforcement lock)", () => {
  const serverAccepts = (v) => serverIsPassword(v) && serverIsByteLengthAllowed(v);
  const clientAccepts = (v) => validateNewPassword(v) === null;

  it("agrees with the server accept/reject verdict on adversarial cases", () => {
    const corpus = [
      "",
      "short1!",
      "alllowercase1!",
      "ALLUPPERCASE1!",
      "NoDigitsHere!",
      "NoSpecial1234",
      "        ", // 8 spaces: length ok, no classes
      GOOD,
      "Aa1!Aa1!",
      "pässW0rd!", // non-ASCII char alongside ASCII classes — accepted by both
      "PÄSSW0RD!", // no ASCII lowercase — must fail both
      "Password１２３!", // full-width digits are not \d — must fail both
      "Aa1!".padEnd(72, "x"), // 72 bytes, compliant
      "Aa1!".padEnd(73, "x"), // 73 bytes — byte cap rejects
      `${"😀".repeat(17)}Aa1!`, // exactly 72 bytes — accepted
      `${"😀".repeat(17)}Aa1!!`, // 73 bytes — rejected
    ];
    for (const v of corpus) {
      expect(
        clientAccepts(v),
        `client/server disagree on ${JSON.stringify(v)}`
      ).toBe(serverAccepts(v));
    }
  });

  it("agrees with the server on 2000 deterministic fuzz passwords", () => {
    // mulberry32 with a fixed seed: reproducible, no flaky randomness.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = "aA0!xZ9@qQ#mM$zZ%ä😀 ";
    const pick = () => alphabet[Math.floor(rand() * alphabet.length)];
    for (let i = 0; i < 2000; i += 1) {
      const len = Math.floor(rand() * 80);
      let v = "";
      for (let j = 0; j < len; j += 1) v += pick();
      expect(
        clientAccepts(v),
        `client/server disagree on fuzz case ${i}: ${JSON.stringify(v)}`
      ).toBe(serverAccepts(v));
    }
  });
});
