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
  OTP_LOCKOUT_LIMIT,
  OTP_LOCKOUT_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  describeOtpAttemptsLeft,
  describeOtpBurn,
  describeOtpTtl,
  formatLockWait,
  isDeliverableEmailAddress,
  maskEmailAddress,
  parseOtpAttemptsLeft,
  parseOtpLock,
  parseOtpStrike,
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

// The account bucket is consulted by both entry points, so every test runs
// through an allowed-by-default limiter; a locked-state test overrides it once.
vi.mock("@/lib/rate-limit", () => ({
  peekRateLimit: vi.fn(async () => ({ allowed: true, remaining: 3, retryAfter: 0 })),
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 2, retryAfter: 0 })),
}));
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";

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
  vi.clearAllMocks();
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

  it("refuses to mint a code while the account's OTP lock is active", async () => {
    vi.mocked(peekRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 420 });
    // txImpl is null: reaching the transaction at all would throw, so this also
    // pins that the gate runs before any challenge work.
    const issued = await issueLoginChallenge({ employeeId: 8 });
    expect(issued).toEqual({ ok: false, reason: "otp_locked", retryAfterSeconds: 420 });
    expect(peekRateLimit).toHaveBeenCalledWith("lockout:otp:8", {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
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

  it("gates issueEmergencyCode too — the admin path inherits the account lock", async () => {
    vi.mocked(peekRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 300 });
    // txImpl is null: entering the transaction at all would throw, so this also
    // pins that break-glass inherits the gate before any challenge work.
    const issued = await issueEmergencyCode({ employeeId: 48 });
    expect(issued).toEqual({ ok: false, reason: "otp_locked", retryAfterSeconds: 300 });
    expect(peekRateLimit).toHaveBeenCalledWith("lockout:otp:48", {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
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

    expect(factor).toEqual({ ok: false, reason: "attempts_exhausted", attemptsRemaining: 0, strike: 1 });
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

  it("refuses verification entirely while the account's OTP lock is active", async () => {
    vi.mocked(peekRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 420 });
    // txImpl is null: any challenge or recovery lookup would throw, so the gate
    // provably runs first — no attempt is spent while the account is frozen.
    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" });
    expect(factor).toEqual({ ok: false, reason: "otp_locked", retryAfterSeconds: 420 });
  });

  it("spends exactly one account hit per burned challenge", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });

    expect(factor).toMatchObject({ ok: false, reason: "attempts_exhausted", attemptsRemaining: 0 });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledWith("lockout:otp:8", {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
  });

  it("flags the burn that reaches the lockout ceiling", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      allowed: true,
      remaining: 0,
      retryAfter: 0,
      windowRetryAfter: 733,
    });
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
    expect(factor.lockTripped).toBe(true);
    expect(factor.strike).toBe(OTP_LOCKOUT_LIMIT);
    // The freeze answers with the window's true remainder — counted from the
    // FIRST burn — never a fresh 900 from now.
    expect(factor.retryAfterSeconds).toBe(733);
  });

  it("leaves lockTripped unset on a burn that still has room", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
    expect(factor.lockTripped).toBeUndefined();
    expect(factor.strike).toBe(1);
    expect(factor.retryAfterSeconds).toBeUndefined();
  });

  it("counts the middle burn as strike two", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
      windowRetryAfter: 400,
    });
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
    expect(factor).toMatchObject({ ok: false, reason: "attempts_exhausted", strike: 2 });
    expect(factor.lockTripped).toBeUndefined();
  });

  it("leaves the bucket alone on an ordinary wrong code", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow()] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
    expect(factor.reason).toBe("invalid");
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("clears the account bucket after a successful code", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [loginChallengeRow()] }],
      ["UPDATE mfa_recovery_codes", { rows: [] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "123456" });
    expect(factor).toEqual({ ok: true, method: "otp" });
    expect(query).toHaveBeenCalledWith("DELETE FROM auth_rate_limits WHERE bucket_key = $1", ["lockout:otp:8"]);
  });

  it("clears the account bucket after a successful recovery code too", async () => {
    const tx = makeTx([
      ["FROM email_otp_challenges", { rows: [] }],
      ["UPDATE mfa_recovery_codes", { rows: [{ recovery_code_id: 9 }] }],
    ]);
    txImpl = tx;

    const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "ABCDEF0123456789ABCD" });
    expect(factor).toEqual({ ok: true, method: "recovery" });
    expect(query).toHaveBeenCalledWith("DELETE FROM auth_rate_limits WHERE bucket_key = $1", ["lockout:otp:8"]);
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

describe("OTP_LOCKED token", () => {
  it("parses the seconds the server sent", () => {
    expect(parseOtpLock("OTP_LOCKED:900")).toBe(900);
    expect(parseOtpLock("OTP_LOCKED:45")).toBe(45);
  });

  it("ignores every other message", () => {
    expect(parseOtpLock("MFA_INVALID")).toBeNull();
    expect(parseOtpLock("OTP_UNDELIVERABLE")).toBeNull();
    expect(parseOtpLock(null)).toBeNull();
    expect(parseOtpLock(undefined)).toBeNull();
  });

  it("refuses malformed seconds rather than inventing a wait", () => {
    expect(parseOtpLock("OTP_LOCKED:")).toBeNull();
    expect(parseOtpLock("OTP_LOCKED:abc")).toBeNull();
    expect(parseOtpLock("OTP_LOCKED:0")).toBeNull();
    expect(parseOtpLock("OTP_LOCKED:-30")).toBeNull();
  });

  it("speaks whole minutes and honest seconds for the lock copy", () => {
    expect(formatLockWait(420)).toBe("7 minutes");
    expect(formatLockWait(60)).toBe("1 minute");
    expect(formatLockWait(45)).toBe("45 seconds");
    expect(formatLockWait(1)).toBe("1 second");
  });
});

describe("OTP_ATTEMPTS_LEFT token", () => {
  it("holds the three-attempt ceiling the product decided on", () => {
    // The ceiling is a product decision, not an implementation detail: the
    // token range, the burn copy and both clients' clamping all read it, so a
    // future change has to be a deliberate edit to this pin.
    expect(OTP_MAX_ATTEMPTS).toBe(3);
  });

  it("parses a count inside the challenge policy", () => {
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:2")).toBe(2);
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:1")).toBe(1);
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:3")).toBe(OTP_MAX_ATTEMPTS);
  });

  it("falls through on anything malformed or out of policy", () => {
    for (const bad of [
      "OTP_ATTEMPTS_LEFT:0",
      "OTP_ATTEMPTS_LEFT:4",
      "OTP_ATTEMPTS_LEFT:6",
      "OTP_ATTEMPTS_LEFT:1.5",
      "OTP_ATTEMPTS_LEFT:abc",
      "OTP_ATTEMPTS_LEFT",
      "OTP_STRIKE:2",
      "MFA_INVALID",
      null,
      undefined,
      4,
    ]) {
      expect(parseOtpAttemptsLeft(bad)).toBeNull();
    }
  });
});

describe("OTP_STRIKE token", () => {
  it("parses a strike inside the lockout policy", () => {
    expect(parseOtpStrike("OTP_STRIKE:1")).toBe(1);
    expect(parseOtpStrike("OTP_STRIKE:3")).toBe(OTP_LOCKOUT_LIMIT);
  });

  it("falls through on anything malformed or out of policy", () => {
    for (const bad of [
      "OTP_STRIKE:0",
      "OTP_STRIKE:4",
      "OTP_STRIKE:1.5",
      "OTP_STRIKE:abc",
      "OTP_STRIKE",
      "OTP_ATTEMPTS_LEFT:2",
      "MFA_INVALID",
      null,
      undefined,
      "2",
    ]) {
      expect(parseOtpStrike(bad)).toBeNull();
    }
  });
});

/**
 * The copy helpers are the contract between the wire token and the screen.
 * They live in the policy module precisely so the three login surfaces cannot
 * say different things about the same verdict — which is how the mobile OTP
 * screen ended up the only one that did not tell the user to request a new
 * code after the last failure.
 */
describe("describeOtpAttemptsLeft", () => {
  it("counts down while attempts remain", () => {
    expect(describeOtpAttemptsLeft(3)).toBe("Incorrect code. 3 attempts left.");
    expect(describeOtpAttemptsLeft(2)).toBe("Incorrect code. 2 attempts left.");
    expect(describeOtpAttemptsLeft(OTP_MAX_ATTEMPTS)).toBe(
      `Incorrect code. ${OTP_MAX_ATTEMPTS} attempts left.`
    );
  });

  it("names the cost of the last attempt, because the next failure cancels the code", () => {
    const last = describeOtpAttemptsLeft(1);
    expect(last).toContain("1 attempt left");
    expect(last).toContain("cancels this code");
    expect(last).toContain("password again");
  });

  it("clamps anything out of policy instead of printing it", () => {
    expect(describeOtpAttemptsLeft(99)).toBe(describeOtpAttemptsLeft(OTP_MAX_ATTEMPTS));
    expect(describeOtpAttemptsLeft(0)).toBe(describeOtpAttemptsLeft(1));
    expect(describeOtpAttemptsLeft(-3)).toBe(describeOtpAttemptsLeft(1));
    expect(describeOtpAttemptsLeft("nonsense")).toBe(describeOtpAttemptsLeft(OTP_MAX_ATTEMPTS));
    expect(describeOtpAttemptsLeft(1.5)).toBe(describeOtpAttemptsLeft(1));
  });
});

describe("describeOtpBurn", () => {
  it("says what happened, then what to do, then what it costs", () => {
    const msg = describeOtpBurn({ strike: 1 });
    const lines = msg.split("\n");
    // Three lines in the order describeOtpBurn's own JSDoc fixes: event,
    // action, deterrent. The opener is not a restatement — it is the only
    // place the reader is told the code in their hand is dead. The attempt
    // copy before it could only promise that one MORE wrong code would do it.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`Your code was cancelled after ${OTP_MAX_ATTEMPTS} wrong codes.`);
    expect(lines[1]).toBe("Enter your password again to get a new code.");
    expect(lines[2]).toBe(
      `Cancelled code 1 of ${OTP_LOCKOUT_LIMIT} — ${OTP_LOCKOUT_LIMIT - 1} more will lock this account for ` +
        `${Math.round(OTP_LOCKOUT_WINDOW_MS / 60_000)} minutes.`
    );
  });

  it("counts cancelled codes, never 'failed codes', so the number matches what a strike is", () => {
    // A strike is one *code* (three wrong entries), so the old "2 more failed
    // codes" understated the cost threefold. The unit is pinned, both plurals —
    // and so is the word the screen uses: the wording pass dropped "strike"
    // from the copy, so only the OTP_STRIKE token and the `strike` field may
    // carry it. This is the assertion the copy used to fail, so pin it hard.
    const second = describeOtpBurn({ strike: 2 });
    expect(second).not.toMatch(/failed code/);
    expect(second).not.toMatch(/strike/i);
    expect(second).toContain(
      `Cancelled code 2 of ${OTP_LOCKOUT_LIMIT} — 1 more will lock this account for ` +
        `${Math.round(OTP_LOCKOUT_WINDOW_MS / 60_000)} minutes.`
    );
  });

  it("never promises a code that nothing sent", () => {
    // Auto-resend left with the 3-attempt policy: a strike mints nothing, so
    // no burn copy may claim a replacement is in flight.
    for (const strike of [1, 2, 3]) {
      const msg = describeOtpBurn({ strike });
      expect(msg).not.toContain("on its way");
      expect(msg).not.toContain("couldn't send");
    }
  });

  it("drops the lock warning when the lock would already have tripped", () => {
    const last = describeOtpBurn({ strike: OTP_LOCKOUT_LIMIT });
    expect(last).toContain(`Cancelled code ${OTP_LOCKOUT_LIMIT} of ${OTP_LOCKOUT_LIMIT}.`);
    expect(last).not.toContain("lock this account");
  });

  it("derives the ceiling and the window from the policy constants", () => {
    const minutes = Math.round(OTP_LOCKOUT_WINDOW_MS / 60_000);
    const msg = describeOtpBurn({ strike: 1 });
    expect(msg).toContain(`Cancelled code 1 of ${OTP_LOCKOUT_LIMIT} —`);
    expect(msg).toContain(`${minutes} minute${minutes === 1 ? "" : "s"}.`);
  });

  it("clamps an out-of-policy strike rather than printing it", () => {
    // 99 clamps to the ceiling, where the warning is dropped (a period, no
    // clause); 0 and nonsense clamp to 1, where the warning clause is present.
    expect(describeOtpBurn({ strike: 99 })).toContain(
      `Cancelled code ${OTP_LOCKOUT_LIMIT} of ${OTP_LOCKOUT_LIMIT}.`
    );
    expect(describeOtpBurn({ strike: "not-a-number" })).toContain(
      `Cancelled code 1 of ${OTP_LOCKOUT_LIMIT} —`
    );
    expect(describeOtpBurn({ strike: 0 })).toContain(
      `Cancelled code 1 of ${OTP_LOCKOUT_LIMIT} —`
    );
  });
});
