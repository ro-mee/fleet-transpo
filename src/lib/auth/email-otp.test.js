import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  issueLoginChallenge,
  verifyLoginChallenge,
  issueEmergencyCode,
  OTP_PURPOSE_BREAK_GLASS,
  OTP_PURPOSE_LOGIN,
} from "./email-otp";
import {
  OTP_BREAK_GLASS_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  describeOtpTtl,
  isDeliverableEmailAddress,
  maskEmailAddress,
} from "./otp-policy";

/**
 * These are control-flow tests against a scripted transaction, not integration
 * tests: what they pin down is *which statements run in which order*, because
 * that ordering is the security property. "Retire the old challenge, then insert
 * the new one" is what makes one live code per employee true; "compare, then
 * consume" is what makes a code single-use. Both were exercised end-to-end
 * against the live `email_otp_challenges` table during development; the fake
 * transaction below is what keeps the ordering from regressing silently.
 */

let txImpl;
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: (fn) => fn(txImpl),
}));

/**
 * Builds a fake `tx` that answers by SQL substring and records every call.
 *
 * Unmatched writes resolve to "no rows affected" rather than throwing, so a test
 * only has to script the statements it actually asserts on. Unmatched *reads*
 * still throw: an unexpected SELECT means the module started consulting
 * something the test did not know about, which is worth failing over.
 */
function makeTx(handlers) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      for (const [pattern, result] of handlers) {
        if (normalized.includes(pattern)) {
          return typeof result === "function" ? result(params) : result;
        }
      }
      if (/^(UPDATE|INSERT|DELETE)\b/.test(normalized)) return { rows: [] };
      throw new Error(`unexpected query in test: ${normalized}`);
    }),
  };
}

const ACTIVE_ACCOUNT = { rows: [{ auth_version: 3 }] };
const NO_ACCOUNT = { rows: [] };

function loginChallengeRow(overrides = {}) {
  return {
    challenge_id: "11111111-1111-1111-1111-111111111111",
    code_hash: hashOtpCode("123456"),
    purpose: OTP_PURPOSE_LOGIN,
    attempts: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    auth_version: 3,
    ...overrides,
  };
}

beforeEach(() => {
  txImpl = null;
});

describe("generateOtpCode", () => {
  it("always produces a zero-padded six-digit string", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("reaches the low end of the space, so leading zeros are not lost", () => {
    // A naive `randomInt(100000, 1000000)` would pass the format check above and
    // still silently exclude a tenth of the space.
    const codes = new Set(Array.from({ length: 4000 }, () => generateOtpCode()));
    expect([...codes].some((code) => code.startsWith("0"))).toBe(true);
  });
});

describe("hashOtpCode", () => {
  it("ignores the separators people type from a screen", () => {
    expect(hashOtpCode("123 456")).toBe(hashOtpCode("123-456"));
    expect(hashOtpCode("123456")).toBe(hashOtpCode(" 123456 "));
  });

  it("is a 64-character hex digest, matching the CHAR(64) column", () => {
    expect(hashOtpCode("123456")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("issueLoginChallenge", () => {
  it("retires the previous challenge before inserting the new one", async () => {
    const tx = makeTx([
      ["FROM employees", ACTIVE_ACCOUNT],
      ["FROM email_otp_challenges", { rows: [] }],
      ["RETURNING expires_at", { rows: [{ expires_at: "2026-09-22T10:00:00Z" }] }],
    ]);
    txImpl = tx;

    const issued = await issueLoginChallenge({ employeeId: 8, ip: "1.2.3.4" });

    expect(issued.ok).toBe(true);
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.purpose).toBe(OTP_PURPOSE_LOGIN);

    const retireIndex = tx.calls.findIndex((c) =>
      c.sql.startsWith("UPDATE email_otp_challenges SET consumed_at = NOW() WHERE employee_id")
    );
    const insertIndex = tx.calls.findIndex((c) => c.sql.startsWith("INSERT INTO email_otp_challenges"));
    expect(retireIndex).toBeGreaterThan(-1);
    expect(retireIndex).toBeLessThan(insertIndex);
  });

  it("stores only the digest — the code never reaches the database", async () => {
    const tx = makeTx([
      ["FROM employees", ACTIVE_ACCOUNT],
      ["FROM email_otp_challenges", { rows: [] }],
      ["RETURNING expires_at", { rows: [{ expires_at: "2026-09-22T10:00:00Z" }] }],
    ]);
    txImpl = tx;

    const issued = await issueLoginChallenge({ employeeId: 8 });
    const insert = tx.calls.find((c) => c.sql.startsWith("INSERT INTO email_otp_challenges"));

    expect(insert.params).toContain(hashOtpCode(issued.code));
    expect(insert.params).not.toContain(issued.code);
    // params: [employeeId, hash, purpose, maxAttempts, authVersion, ttlSeconds, ip, ua]
    expect(Number(insert.params[3])).toBe(OTP_MAX_ATTEMPTS);
    expect(Number(insert.params[5])).toBe(OTP_TTL_SECONDS);
  });

  it("refuses to mail a second code inside the resend cooldown", async () => {
    const tx = makeTx([
      ["FROM employees", ACTIVE_ACCOUNT],
      ["FROM email_otp_challenges", { rows: [{ challenge_id: "c1", purpose: OTP_PURPOSE_LOGIN, created_at: "now" }] }],
      ["age_seconds", { rows: [{ age_seconds: OTP_RESEND_COOLDOWN_SECONDS - 10 }] }],
    ]);
    txImpl = tx;

    const issued = await issueLoginChallenge({ employeeId: 8 });

    expect(issued).toMatchObject({ ok: false, reason: "cooldown", retryAfterSeconds: 10 });
    expect(tx.calls.some((c) => c.sql.startsWith("INSERT INTO email_otp_challenges"))).toBe(false);
  });

  it("never replaces a live administrator-issued emergency code", async () => {
    // The deadlock this prevents: the person holding an admin-issued code is by
    // definition the one who cannot receive the email, so mailing over it would
    // destroy their only way in.
    const tx = makeTx([
      ["FROM employees", ACTIVE_ACCOUNT],
      ["FROM email_otp_challenges", { rows: [{ challenge_id: "bg", purpose: OTP_PURPOSE_BREAK_GLASS, created_at: "now" }] }],
    ]);
    txImpl = tx;

    const issued = await issueLoginChallenge({ employeeId: 8 });

    expect(issued).toEqual({ ok: false, reason: "break_glass_held" });
    expect(tx.calls.some((c) => c.sql.startsWith("UPDATE email_otp_challenges"))).toBe(false);
    expect(tx.calls.some((c) => c.sql.startsWith("INSERT INTO email_otp_challenges"))).toBe(false);
  });

  it("gives an emergency code the longer break-glass lifetime", async () => {
    const tx = makeTx([
      ["FROM employees", ACTIVE_ACCOUNT],
      ["FROM email_otp_challenges", { rows: [] }],
      ["RETURNING expires_at", { rows: [{ expires_at: "2026-09-22T10:15:00Z" }] }],
    ]);
    txImpl = tx;

    const issued = await issueEmergencyCode({ employeeId: 48 });
    const insert = tx.calls.find((c) => c.sql.startsWith("INSERT INTO email_otp_challenges"));

    expect(issued.purpose).toBe(OTP_PURPOSE_BREAK_GLASS);
    // params: [employeeId, hash, purpose, maxAttempts, authVersion, ttlSeconds, ip, ua]
    expect(Number(insert.params[5])).toBe(OTP_BREAK_GLASS_TTL_SECONDS);
    expect(insert.params[2]).toBe(OTP_PURPOSE_BREAK_GLASS);
  });

  it("reports a missing or inactive account instead of issuing", async () => {
    txImpl = makeTx([["FROM employees", NO_ACCOUNT]]);

    expect(await issueLoginChallenge({ employeeId: 999 })).toEqual({ ok: false, reason: "no_account" });
  });
});

describe("verifyLoginChallenge", () => {
  it("accepts the right code and consumes it", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow()] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" });

    expect(factor).toEqual({ ok: true, method: "otp" });
    expect(
      tx.calls.some((c) => c.sql.startsWith("UPDATE email_otp_challenges SET consumed_at = NOW() WHERE challenge_id"))
    ).toBe(true);
  });

  it("rejects a wrong code and reports the attempts left", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow()] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });

    expect(factor).toEqual({ ok: false, reason: "invalid", attemptsRemaining: OTP_MAX_ATTEMPTS - 1 });
  });

  it("burns the challenge once the attempt ceiling is reached", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" });

    expect(factor).toEqual({ ok: false, reason: "attempts_exhausted", attemptsRemaining: 0 });
    expect(
      tx.calls.some((c) => c.sql.startsWith("UPDATE email_otp_challenges SET consumed_at = NOW() WHERE challenge_id"))
    ).toBe(true);
  });

  it("retires a challenge minted before a credential change", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ auth_version: 2 })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" });

    expect(factor).toEqual({ ok: false, reason: "stale" });
    expect(
      tx.calls.some((c) => c.sql.startsWith("UPDATE email_otp_challenges SET consumed_at = NOW() WHERE challenge_id"))
    ).toBe(true);
  });

  it("accepts a driver-issued emergency code through the same consume path", async () => {
    // The break-glass half of the round trip: an administrator issues a
    // `break_glass` challenge out of band and reads the code aloud, so the only
    // thing that can prove the path works is that `verifyLoginChallenge` consumes
    // it exactly like an emailed one. Issue and consume are tested separately
    // because they are separate functions, and a mismatch between the purpose
    // they write and the purpose they accept would lock out precisely the account
    // that has no other way in.
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ purpose: OTP_PURPOSE_BREAK_GLASS })] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 48, authVersion: 3, code: "123456" });

    expect(factor).toEqual({ ok: true, method: "otp" });
    expect(
      tx.calls.some((c) => c.sql.startsWith("UPDATE email_otp_challenges SET consumed_at = NOW() WHERE challenge_id"))
    ).toBe(true);
    // Consumption is what makes it single-use, and it must not care which
    // purpose the row carries.
    expect(tx.calls.find((c) => c.sql.startsWith("SELECT"))?.sql).not.toMatch(/purpose\s*=/);
  });

  it("accepts a recovery code when no challenge is live", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [] }],
      ["UPDATE mfa_recovery_codes", { rows: [{ recovery_code_id: 9 }] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "ABCDEF0123456789ABCD" });

    expect(factor).toEqual({ ok: true, method: "recovery" });
  });

  it("reports the code as expired when neither a challenge nor a recovery code matches", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    expect(await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" })).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("isDeliverableEmailAddress", () => {
  it("accepts a routable mailbox", () => {
    expect(isDeliverableEmailAddress("zarahjanelorente17@gmail.com")).toBe(true);
  });

  it("refuses the placeholder domains seeded across the live accounts", () => {
    for (const address of [
      "admin@fleetops.com",
      "test-driver@gmail.com.example.com",
      "driver@example.com",
      "someone@localhost",
      "x@invalid",
      "y@harness",
    ]) {
      expect(isDeliverableEmailAddress(address)).toBe(false);
    }
  });

  it("refuses shapes that are not addresses at all", () => {
    for (const value of ["", null, undefined, "not-an-email", "@gmail.com", "user@"]) {
      expect(isDeliverableEmailAddress(value)).toBe(false);
    }
  });
});

describe("maskEmailAddress", () => {
  it("hides the mailbox name but keeps the domain readable", () => {
    // The domain is the point: an account pointing at a stranger's Gmail is a
    // failure the user can only catch if they can see where the code went.
    const masked = maskEmailAddress("zarahjanelorente17@gmail.com");
    expect(masked).toMatch(/^za•+@gmail\.com$/);
    expect(masked).not.toContain("janelorente");
    // A short mailbox still gets a floor, so the mask never leaks its length
    // down to one character.
    expect(maskEmailAddress("ab@yahoo.com")).toBe("ab•••@yahoo.com");
  });

  it("leaves an unparseable value alone rather than inventing a mask", () => {
    expect(maskEmailAddress("nonsense")).toBe("nonsense");
  });
});

describe("describeOtpTtl", () => {
  it("speaks in minutes when the ttl divides evenly", () => {
    expect(describeOtpTtl(300)).toBe("5 minutes");
    expect(describeOtpTtl(900)).toBe("15 minutes");
    expect(describeOtpTtl(60)).toBe("1 minute");
  });
});
