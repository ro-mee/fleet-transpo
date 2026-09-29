# OTP Attempts & Strike Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the OTP lockout's real cost to the user — attempts-left after every wrong code, strike N of 3 when a challenge burns, and the exact freeze countdown immediately on the 3rd burn — on both web and mobile.

**Architecture:** Three value-bearing error tokens (`OTP_ATTEMPTS_LEFT:<n>`, `OTP_STRIKE:<n>`, `OTP_LOCKED:<seconds>`) ride the existing throw/ApiError convention from the shared `email-otp.js` choke point through `auth.js` (web) and the mobile login route, parsed by range-checked helpers in `otp-policy.js` mirrored by `mobile/lib/otp.js`. Exact freeze seconds come from a new `windowRetryAfter` field on `rateLimit()` — the SQL already computes the window remainder; the JS just stops zeroing it. Spec: `docs/superpowers/specs/2026-09-27-otp-attempts-strikes-warning-design.md`.

**Tech Stack:** Next.js (web + API routes), Expo (mobile), Vitest, source-pin security tests (`src/security-assessment/`), PostgreSQL-backed `auth_rate_limits` (no schema changes).

## Global Constraints

- Work on a new branch `feat/otp-attempts-warning` created off `main` (step 1 of Task 1).
- **Stage only files you touched.** The repo carries ~115 unrelated dirty files — never `git add -A`.
- No migrations, no `schema.sql` edits, no DB changes of any kind.
- No new endpoints; `/api/auth/login-status` must keep reporting **no** OTP state (its pin in `src/app/api/auth/login-status/route.test.js` must stay green).
- Token wire format: `OTP_ATTEMPTS_LEFT:<n>` (integer 1..5), `OTP_STRIKE:<n>` (integer 1..3), `OTP_LOCKED:<seconds>` (true window remainder). Nothing else may ride the message.
- UI copy is contract — strings below are verbatim from the spec.
- Tests: `npm run test:run -- <path>`; full suite `npm run test:run` (baseline: 208 files / 2557 tests, must not drop).
- Lint each touched file with `npm run lint:ci -- <path>` (0 warnings).
- One conventional commit per task; commit only that task's files.

---

### Task 1: `rateLimit()` gains `windowRetryAfter`

**Files:**
- Modify: `src/lib/rate-limit.js:9` (JSDoc), `:44-52` (both returns)
- Test: `src/security-assessment/auth-session.security.test.js` (SEC-AUTH-002 block, ~line 103)

**Interfaces:**
- Produces: `rateLimit()` returns `{ allowed, remaining, retryAfter, windowRetryAfter }` where `windowRetryAfter` is the window's true remaining seconds **regardless of `allowed`** (also present on the fail-closed path). `allowed`/`remaining`/`retryAfter` unchanged. `peekRateLimit()` unchanged.
- No consumers yet — Task 2 reads `bucket.windowRetryAfter`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/otp-attempts-warning
```

- [ ] **Step 2: Write the failing tests** — in `auth-session.security.test.js`, inside `describe('SEC-AUTH-002 — credential throttles fail closed where the edge guard fails open')`, immediately after the `it('a limiter outage refuses the attempt instead of allowing it', ...)` test, add:

```js
  it('an allowed result still reports the window true wait, for the OTP freeze countdown', async () => {
    query.mockResolvedValueOnce({ rows: [{ hit_count: 1, retry_after: 847 }] });
    const result = await rateLimit('lockout:otp:8', { limit: 3, windowMs: 900_000 });
    expect(result).toMatchObject({
      allowed: true,
      remaining: 2,
      retryAfter: 0,
      windowRetryAfter: 847,
    });
  });

  it('once the limit is passed the window wait equals the retry after', async () => {
    query.mockResolvedValueOnce({ rows: [{ hit_count: 4, retry_after: 612 }] });
    const result = await rateLimit('lockout:otp:8', { limit: 3, windowMs: 900_000 });
    expect(result).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfter: 612,
      windowRetryAfter: 612,
    });
  });
```

Also extend the existing outage test (same describe) — add one assertion after `expect(result.retryAfter).toBeGreaterThan(0);`:

```js
    expect(result.windowRetryAfter).toBe(result.retryAfter);
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: FAIL — `windowRetryAfter` is `undefined` in all three assertions.

- [ ] **Step 4: Implement** — in `src/lib/rate-limit.js`:

JSDoc line 9 — replace:
```
 * Returns { allowed, remaining, retryAfter }.
```
with:
```
 * Returns { allowed, remaining, retryAfter, windowRetryAfter }.
 * `windowRetryAfter` is the window's true remaining seconds regardless of
 * `allowed` — the OTP lockout answers a just-tripped freeze with it, and the
 * window opened at the account's FIRST burn, so a fresh `windowMs` from now
 * would overstate the wait.
```

Success return (lines 44-48) — replace with:

```js
    return {
      allowed: hitCount <= limit,
      remaining: Math.max(0, limit - hitCount),
      retryAfter: hitCount <= limit ? 0 : retryAfter,
      windowRetryAfter: retryAfter,
    };
```

Fail-closed return (line 51) — replace with:

```js
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(windowMs / 1000),
      windowRetryAfter: Math.ceil(windowMs / 1000),
    };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: PASS, whole file green.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint:ci -- src/lib/rate-limit.js src/security-assessment/auth-session.security.test.js
git add src/lib/rate-limit.js src/security-assessment/auth-session.security.test.js
git commit -m "feat(auth): expose the rate window's true retry seconds"
```

---

### Task 2: `verifyLoginChallenge` reports strike number and exact freeze seconds

**Files:**
- Modify: `src/lib/auth/email-otp.js:185-190` (JSDoc), `:281-288` (burn branch)
- Test: `src/lib/auth/email-otp.test.js` (lines 270-282, 372-391)

**Interfaces:**
- Consumes: `rateLimit(...).windowRetryAfter` (Task 1).
- Produces: `verifyLoginChallenge` outcome gains `strike: 1|2|3` on every `attempts_exhausted`, and `retryAfterSeconds: number` alongside `lockTripped: true` on the 3rd burn. `invalid` still carries `attemptsRemaining` (4..1). Tasks 4/6 read `factor.strike` and `factor.retryAfterSeconds`.

- [ ] **Step 1: Write the failing tests** — edits to `src/lib/auth/email-otp.test.js`:

(a) In `it("burns the challenge once the attempt ceiling is reached")` (line 278), replace:

```js
    expect(factor).toEqual({ ok: false, reason: "attempts_exhausted", attemptsRemaining: 0 });
```
with:
```js
    expect(factor).toEqual({ ok: false, reason: "attempts_exhausted", attemptsRemaining: 0, strike: 1 });
```
(Default limiter mock is `{ allowed: true, remaining: 2, ... }`, so strike = 3 − 2 = 1.)

(b) Replace the whole `it("flags the burn that reaches the lockout ceiling", ...)` test (lines 372-381) with:

```js
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
```

(c) In `it("leaves lockTripped unset on a burn that still has room")` (line 390), after `expect(factor.lockTripped).toBeUndefined();` add:

```js
    expect(factor.strike).toBe(1);
    expect(factor.retryAfterSeconds).toBeUndefined();
```

(d) Add a new test directly after (c):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- src/lib/auth/email-otp.test.js
```
Expected: FAIL — `strike`/`retryAfterSeconds` are `undefined` (`toEqual` mismatch; `toBe(1)` on undefined).

- [ ] **Step 3: Implement** — in `src/lib/auth/email-otp.js`:

(a) JSDoc (lines 186-187) — replace:
```
 *   { ok: false, reason: "expired" | "stale" | "invalid" | "attempts_exhausted",
 *     attemptsRemaining?, lockTripped? }
```
with:
```
 *   { ok: false, reason: "expired" | "stale" | "invalid" | "attempts_exhausted",
 *     attemptsRemaining?, strike?, lockTripped?, retryAfterSeconds? }
```

(b) Burn branch (lines 281-288) — replace:

```js
  if (outcome?.reason === "attempts_exhausted") {
    const bucket = await rateLimit(otpLockoutKey(employeeId), {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
    // `allowed` is still true at the ceiling (hitCount <= limit); the trip is
    // signalled by there being no room left.
    if (bucket.remaining === 0) outcome.lockTripped = true;
  } else if (outcome?.ok === true) {
```
with:
```js
  if (outcome?.reason === "attempts_exhausted") {
    const bucket = await rateLimit(otpLockoutKey(employeeId), {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
    // One strike per burned challenge, numbered from the DB-authoritative
    // bucket — the number the user reads can never drift from the number that
    // locks, even under concurrent attempts. `allowed` is still true at the
    // ceiling (hitCount <= limit); the trip is signalled by no room left.
    outcome.strike = OTP_LOCKOUT_LIMIT - bucket.remaining;
    if (bucket.remaining === 0) {
      outcome.lockTripped = true;
      // The window opened at burn #1, so the freeze countdown is the SQL's
      // true remainder, not a fresh window from now.
      outcome.retryAfterSeconds = bucket.windowRetryAfter;
    }
  } else if (outcome?.ok === true) {
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/lib/auth/email-otp.test.js
```
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- src/lib/auth/email-otp.js src/lib/auth/email-otp.test.js
git add src/lib/auth/email-otp.js src/lib/auth/email-otp.test.js
git commit -m "feat(auth): number each burned OTP challenge and carry exact freeze seconds"
```

---

### Task 3: Server parsers `parseOtpAttemptsLeft` / `parseOtpStrike`

**Files:**
- Modify: `src/lib/auth/otp-policy.js` (after `parseOtpLock`, line 85)
- Test: `src/lib/auth/email-otp.test.js` (after the `describe("OTP_LOCKED token", ...)` block, ~line 500)

**Interfaces:**
- Consumes: `OTP_MAX_ATTEMPTS` (5), `OTP_LOCKOUT_LIMIT` (3) — already defined in the same file (lines 30, 41).
- Produces: exports `OTP_ATTEMPTS_LEFT_PREFIX`, `OTP_STRIKE_PREFIX`, `parseOtpAttemptsLeft(message) → number|null`, `parseOtpStrike(message) → number|null`. Range-checked against the policy constants; null for anything malformed. Tasks 5/7 import these; the UI branch and the copy both key off `!== null`.

- [ ] **Step 1: Write the failing tests** — in `email-otp.test.js`:

(a) Add `parseOtpAttemptsLeft, parseOtpStrike,` to the `./otp-policy` import block (lines 11-23, next to `parseOtpLock`).

(b) After the `describe("OTP_LOCKED token", ...)` block, add:

```js
describe("OTP_ATTEMPTS_LEFT token", () => {
  it("parses a count inside the challenge policy", () => {
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:4")).toBe(4);
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:1")).toBe(1);
    expect(parseOtpAttemptsLeft("OTP_ATTEMPTS_LEFT:5")).toBe(OTP_MAX_ATTEMPTS);
  });

  it("falls through on anything malformed or out of policy", () => {
    for (const bad of [
      "OTP_ATTEMPTS_LEFT:0",
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- src/lib/auth/email-otp.test.js
```
Expected: FAIL — `parseOtpAttemptsLeft is not a function`.

- [ ] **Step 3: Implement** — in `src/lib/auth/otp-policy.js`, directly after `parseOtpLock` (line 85), insert:

```js
/** Wire prefix of the attempts-left token both login channels speak. */
export const OTP_ATTEMPTS_LEFT_PREFIX = "OTP_ATTEMPTS_LEFT:";

/** Wire prefix of the burn-strike token both login channels speak. */
export const OTP_STRIKE_PREFIX = "OTP_STRIKE:";

/**
 * Remaining attempts from an `OTP_ATTEMPTS_LEFT:<n>` token, or null for
 * anything else. Same contract as parseOtpLock: one helper decides both the
 * branch and the count, a malformed token falls through to the caller's
 * generic message, and the range is checked against the policy ceiling so a
 * corrupt token cannot show "7 attempts left" under a 5-attempt challenge.
 */
export function parseOtpAttemptsLeft(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_ATTEMPTS_LEFT_PREFIX)) return null;
  const count = Number(message.slice(OTP_ATTEMPTS_LEFT_PREFIX.length));
  return Number.isInteger(count) && count >= 1 && count <= OTP_MAX_ATTEMPTS ? count : null;
}

/**
 * Strike number (1..OTP_LOCKOUT_LIMIT) from an `OTP_STRIKE:<n>` token, or
 * null for anything else. The 3rd burn never carries this token — it carries
 * `OTP_LOCKED:<seconds>` — so 3 is accepted only as a defensive ceiling.
 */
export function parseOtpStrike(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_STRIKE_PREFIX)) return null;
  const strike = Number(message.slice(OTP_STRIKE_PREFIX.length));
  return Number.isInteger(strike) && strike >= 1 && strike <= OTP_LOCKOUT_LIMIT ? strike : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/lib/auth/email-otp.test.js
```
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- src/lib/auth/otp-policy.js src/lib/auth/email-otp.test.js
git add src/lib/auth/otp-policy.js src/lib/auth/email-otp.test.js
git commit -m "feat(auth): add OTP_ATTEMPTS_LEFT and OTP_STRIKE token parsers"
```

---

### Task 4: Web `auth.js` maps verify failures to the three tokens

**Files:**
- Modify: `src/lib/auth.js:252-269` (the `if (!factor.ok)` block)
- Test: `src/security-assessment/auth-session.security.test.js` (SEC-AUTH-006 block, insert after the `it('the mobile channel maps otp_locked and raises the same alert')`, ~line 448)

**Interfaces:**
- Consumes: `factor.strike`, `factor.retryAfterSeconds`, `factor.attemptsRemaining` (Task 2); token format is plain strings (parsers come later in the UI tasks).
- Produces: `authorize()` throws `OTP_LOCKED:<s>` (gate **and** 3rd burn), `OTP_STRIKE:<n>` (burns 1-2), `OTP_ATTEMPTS_LEFT:<n>` (wrong code), `MFA_INVALID` (expired/stale fallback, unchanged). Task 5's UI parses exactly these.

- [ ] **Step 1: Write the failing test** — in `auth-session.security.test.js`, inside `describe('SEC-AUTH-006 — burned codes freeze the account, not just the challenge')`, after the `it('the mobile channel maps otp_locked and raises the same alert', ...)`, add:

```js
  it('web verify failures speak attempts, strikes, and an instant freeze, in that safety order', () => {
    const web = read('lib/auth.js');
    expect(web).toMatch(/OTP_ATTEMPTS_LEFT:\$\{factor\.attemptsRemaining\}/);
    expect(web).toMatch(/OTP_STRIKE:\$\{factor\.strike\}/);
    const failBlock = web.slice(web.indexOf('if (!factor.ok)'), web.indexOf('let driverStatus'));
    const lockAt = failBlock.indexOf('factor.reason === "otp_locked" || factor.lockTripped');
    const strikeAt = failBlock.indexOf('OTP_STRIKE');
    const genericAt = failBlock.indexOf('throw new Error("MFA_INVALID")');
    expect(lockAt).toBeGreaterThan(-1);
    expect(strikeAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(-1);
    // The freeze verdict outranks the strike verdict: a trip burn must answer
    // OTP_LOCKED with its exact seconds, never OTP_STRIKE:3.
    expect(lockAt).toBeLessThan(strikeAt);
    expect(strikeAt).toBeLessThan(genericAt);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: FAIL — `Expected -1 to be greater than 0` (no `OTP_ATTEMPTS_LEFT` match).

- [ ] **Step 3: Implement** — in `src/lib/auth.js`, replace the `if (!factor.ok)` block (lines 252-269):

```js
          if (!factor.ok) {
            // A code that ran out of time is not a wrong code, and neither is
            // one minted before a credential changed. Both are answered by
            // sending a fresh code rather than by spending an attempt on the
            // clock.
            if (factor.reason === "expired" || factor.reason === "stale") {
              await requireCode(await sendNewCode());
            }
            await writeAudit(auditReq, null, {
              action: "mfa_failure",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: { channel: "web", reason: factor.reason },
            });
            // Freeze outranks strike: the 3rd burn answers with the live
            // countdown, never with a "strike 3 of 3" the user cannot act on.
            if (factor.reason === "otp_locked" || factor.lockTripped) {
              throw new Error(`OTP_LOCKED:${factor.retryAfterSeconds}`);
            }
            if (factor.reason === "attempts_exhausted") {
              throw new Error(`OTP_STRIKE:${factor.strike}`);
            }
            if (factor.reason === "invalid") {
              throw new Error(`OTP_ATTEMPTS_LEFT:${factor.attemptsRemaining}`);
            }
            throw new Error("MFA_INVALID");
          }
```

(Keep the existing `factor.lockTripped` → `raiseSecurityAlert` block at lines 239-250 exactly as it is — it runs before this block.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: PASS — the existing SEC-AUTH-006 pins (`OTP_LOCKED:${factor.retryAfterSeconds}` etc.) must still be green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- src/lib/auth.js src/security-assessment/auth-session.security.test.js
git add src/lib/auth.js src/security-assessment/auth-session.security.test.js
git commit -m "feat(auth): map web OTP verify failures to attempts, strike, and instant lock tokens"
```

---

### Task 5: Web login dialog speaks the copy

**Files:**
- Modify: `src/app/(auth)/login/page.js` — import block (lines 18-22), new `failAttempt` helper above `handleMfaSubmit` (line 786), catch block (lines 823-833)
- Test: `src/security-assessment/auth-session.security.test.js` (SEC-AUTH-006 block)

**Interfaces:**
- Consumes: `parseOtpAttemptsLeft`, `parseOtpStrike`, `OTP_LOCKOUT_LIMIT` from `@/lib/auth/otp-policy` (Task 3); thrown tokens from Task 4.
- Produces: visible error copy per failure kind on the MFA dialog; `failAttempt(msg)` local helper shared by the three wrong-code branches.

- [ ] **Step 1: Write the failing test** — in `auth-session.security.test.js`, inside SEC-AUTH-006, after the Task 4 test, add:

```js
  it('the web MFA dialog speaks attempts left, the strike, and shares one failure shape', () => {
    const page = read('app/(auth)/login/page.js');
    expect(page).toMatch(/parseOtpAttemptsLeft\(err\.message\)/);
    expect(page).toMatch(/parseOtpStrike\(err\.message\)/);
    expect(page).toMatch(/Incorrect code — \$\{attemptsLeft\} attempt\$\{attemptsLeft === 1 \? "" : "s"\} left\./);
    expect(page).toMatch(/Strike \$\{strike\} of \$\{OTP_LOCKOUT_LIMIT\} — request a new code\./);
    expect(page).toMatch(/failAttempt\("That verification code is invalid or already used\."\)/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: FAIL — no `parseOtpAttemptsLeft(err.message)` in the page yet.

- [ ] **Step 3: Implement** — three edits in `src/app/(auth)/login/page.js`:

(a) Import — replace:
```js
  parseOtpLock,
} from "@/lib/auth/otp-policy";
```
with:
```js
  OTP_LOCKOUT_LIMIT,
  parseOtpAttemptsLeft,
  parseOtpLock,
  parseOtpStrike,
} from "@/lib/auth/otp-policy";
```

(b) Helper — insert immediately **above** `const handleMfaSubmit = async (submittedCode = mfaCode) => {` (line 786):

```js
  // One failure shape for every wrong-code verdict: mark the dialog in error,
  // clear the cell, and put the caret back where the next code goes.
  const failAttempt = (msg) => {
    setError(msg);
    setMfaCode("");
    setMfaStatus("error");
    setTimeout(() => {
      if (mfaRecoveryMode) mfaRecoveryInputRef.current?.focus();
      else mfaCodeInputRef.current?.focus();
    }, 0);
  };
```

(c) Catch — replace (lines 824-833):

```js
      if (err.message === "MFA_INVALID" || err.message === "CredentialsSignin") {
        setError("That verification code is invalid or already used.");
        setMfaCode("");
        setMfaStatus("error");
        setTimeout(() => {
          if (mfaRecoveryMode) mfaRecoveryInputRef.current?.focus();
          else mfaCodeInputRef.current?.focus();
        }, 0);
        return;
      }
```
with:
```js
      if (err.message === "MFA_INVALID" || err.message === "CredentialsSignin") {
        failAttempt("That verification code is invalid or already used.");
        return;
      }

      const attemptsLeft = parseOtpAttemptsLeft(err.message);
      if (attemptsLeft !== null) {
        failAttempt(`Incorrect code — ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
        return;
      }

      const strike = parseOtpStrike(err.message);
      if (strike !== null) {
        const more = OTP_LOCKOUT_LIMIT - strike;
        failAttempt(
          `That code was wrong. Strike ${strike} of ${OTP_LOCKOUT_LIMIT} — request a new code. ` +
            `${more} more failed code${more === 1 ? "" : "s"} will freeze this account for 15 minutes.`
        );
        return;
      }
```

Leave `MFA_UNAVAILABLE`, `OTP_UNDELIVERABLE`, `TEMP_PASSWORD_EXPIRED`, the `parseOtpLock` branch (~line 857) and everything after exactly as they are — `OTP_LOCKED:<s>` from the instant freeze flows into the existing countdown branch untouched.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js src/security-boundaries.test.js
```
Expected: PASS (the second file pins unrelated login-page content and must stay green).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- "src/app/(auth)/login/page.js" src/security-assessment/auth-session.security.test.js
git add "src/app/(auth)/login/page.js" src/security-assessment/auth-session.security.test.js
git commit -m "feat(web): show attempts-left and strike warnings on OTP login failures"
```

---

### Task 6: Mobile API route maps verify failures to the three tokens

**Files:**
- Modify: `src/app/api/mobile/auth/login/route.js:260-283`
- Test: `src/security-assessment/auth-session.security.test.js` (SEC-AUTH-006 block)

**Interfaces:**
- Consumes: `factor.strike`, `factor.retryAfterSeconds`, `factor.attemptsRemaining` (Task 2); existing helpers `err(message, status)` and `otpLockedResponse(seconds)` (route.js line ~27 builds `OTP_LOCKED:${seconds}`).
- Produces: 401 + `OTP_ATTEMPTS_LEFT:<n>` / `OTP_STRIKE:<n>`; 429 `otpLockedResponse` for the gate **and** the 3rd burn. Task 8's UI parses these.

- [ ] **Step 1: Write the failing test** — in `auth-session.security.test.js`, inside SEC-AUTH-006, after the Task 5 test, add:

```js
  it('the mobile channel maps attempts and strikes and freezes on the third burn itself', () => {
    const mobile = read('app/api/mobile/auth/login/route.js');
    expect(mobile).toMatch(/OTP_ATTEMPTS_LEFT:\$\{factor\.attemptsRemaining\}/);
    expect(mobile).toMatch(/OTP_STRIKE:\$\{factor\.strike\}/);
    const failBlock = mobile.slice(mobile.indexOf('if (!factor.ok)'), mobile.indexOf('const { token: refreshToken'));
    const lockAt = failBlock.indexOf('factor.reason === "otp_locked" || factor.lockTripped');
    const strikeAt = failBlock.indexOf('OTP_STRIKE');
    const genericAt = failBlock.indexOf('return err("MFA_INVALID", 401)');
    expect(lockAt).toBeGreaterThan(-1);
    expect(strikeAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(strikeAt);
    expect(strikeAt).toBeLessThan(genericAt);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: FAIL — no `OTP_ATTEMPTS_LEFT` in the route.

- [ ] **Step 3: Implement** — in `src/app/api/mobile/auth/login/route.js`, replace lines 280-283:

```js
      if (factor.reason === "otp_locked") {
        return otpLockedResponse(factor.retryAfterSeconds);
      }
      return err("MFA_INVALID", 401);
    }
```
with:
```js
      // Freeze outranks strike: the 3rd burn answers with the live countdown,
      // never with a "strike 3 of 3" the user cannot act on.
      if (factor.reason === "otp_locked" || factor.lockTripped) {
        return otpLockedResponse(factor.retryAfterSeconds);
      }
      if (factor.reason === "attempts_exhausted") {
        return err(`OTP_STRIKE:${factor.strike}`, 401);
      }
      if (factor.reason === "invalid") {
        return err(`OTP_ATTEMPTS_LEFT:${factor.attemptsRemaining}`, 401);
      }
      return err("MFA_INVALID", 401);
    }
```

(Leave the `factor.lockTripped` → `raiseSecurityAlert` block at lines 248-259 and the expired/stale auto-resend branch above untouched.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: PASS — existing pins (`OTP_LOCKED:${...}`, `factor.lockTripped`, `factor: "otp"`) still green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- src/app/api/mobile/auth/login/route.js src/security-assessment/auth-session.security.test.js
git add src/app/api/mobile/auth/login/route.js src/security-assessment/auth-session.security.test.js
git commit -m "feat(api): map mobile OTP verify failures to attempts, strike, and instant lock tokens"
```

---

### Task 7: Mobile mirrors of the parsers + parity pins

**Files:**
- Modify: `mobile/lib/otp.js` (after `parseOtpLock`, line 81)
- Test: `mobile/lib/otp.test.js`

**Interfaces:**
- Consumes: server helpers from Task 3 (imported by the test only).
- Produces: exports `OTP_MAX_ATTEMPTS`, `OTP_LOCKOUT_LIMIT`, `OTP_ATTEMPTS_LEFT_PREFIX`, `OTP_STRIKE_PREFIX`, `parseOtpAttemptsLeft`, `parseOtpStrike` — byte-for-byte same behavior as the server. Task 8 imports them.

- [ ] **Step 1: Write the failing tests** — in `mobile/lib/otp.test.js`:

(a) Imports — extend both import blocks:

from `./otp` add: `OTP_ATTEMPTS_LEFT_PREFIX, OTP_LOCKOUT_LIMIT, OTP_MAX_ATTEMPTS, OTP_STRIKE_PREFIX, parseOtpAttemptsLeft, parseOtpStrike,` (keep alphabetical-ish grouping with existing entries);
from `../../src/lib/auth/otp-policy.js` add: `OTP_LOCKOUT_LIMIT as SERVER_LOCKOUT_LIMIT, OTP_MAX_ATTEMPTS as SERVER_MAX_ATTEMPTS, parseOtpAttemptsLeft as serverParseOtpAttemptsLeft, parseOtpStrike as serverParseOtpStrike,`.

(b) In `describe("OTP contract mirrors", ...)`, add:

```js
  it("attempt ceiling matches the server challenge", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(SERVER_MAX_ATTEMPTS);
  });

  it("lockout limit matches the server freeze", () => {
    expect(OTP_LOCKOUT_LIMIT).toBe(SERVER_LOCKOUT_LIMIT);
  });
```

(c) After `describe("OTP_LOCKED token mirrors", ...)`, add:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- mobile/lib/otp.test.js
```
Expected: FAIL — `parseOtpAttemptsLeft is not a function`.

- [ ] **Step 3: Implement** — in `mobile/lib/otp.js`, directly after `parseOtpLock` (line 81), insert:

```js
/** Failed verifications before a challenge burns. Mirrors otp-policy. */
export const OTP_MAX_ATTEMPTS = 5;

/** Burned challenges before the account freezes. Mirrors otp-policy. */
export const OTP_LOCKOUT_LIMIT = 3;

/** Wire prefix of the attempts-left token. Mirrors otp-policy. */
export const OTP_ATTEMPTS_LEFT_PREFIX = "OTP_ATTEMPTS_LEFT:";

/** Wire prefix of the burn-strike token. Mirrors otp-policy. */
export const OTP_STRIKE_PREFIX = "OTP_STRIKE:";

/**
 * Remaining attempts from an `OTP_ATTEMPTS_LEFT:<n>` token, or null.
 * Mirrors the server's parseOtpAttemptsLeft — same range check, so a corrupt
 * token falls through to the generic message instead of a bogus count.
 */
export function parseOtpAttemptsLeft(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_ATTEMPTS_LEFT_PREFIX)) return null;
  const count = Number(message.slice(OTP_ATTEMPTS_LEFT_PREFIX.length));
  return Number.isInteger(count) && count >= 1 && count <= OTP_MAX_ATTEMPTS ? count : null;
}

/**
 * Strike number from an `OTP_STRIKE:<n>` token, or null. Mirrors the
 * server's parseOtpStrike.
 */
export function parseOtpStrike(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_STRIKE_PREFIX)) return null;
  const strike = Number(message.slice(OTP_STRIKE_PREFIX.length));
  return Number.isInteger(strike) && strike >= 1 && strike <= OTP_LOCKOUT_LIMIT ? strike : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- mobile/lib/otp.test.js
```
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- mobile/lib/otp.js mobile/lib/otp.test.js
git add mobile/lib/otp.js mobile/lib/otp.test.js
git commit -m "feat(mobile): mirror the OTP attempts and strike parsers"
```

---

### Task 8: Mobile OTP view + login form speak the copy

**Files:**
- Modify: `mobile/components/otp/OtpVerificationView.jsx` (imports lines 18-30; catch chain line 141-158)
- Modify: `mobile/app/login.js` (import line 27; catch chain lines 196-214)
- Test: `src/security-assessment/auth-session.security.test.js` (SEC-AUTH-006 block)

**Interfaces:**
- Consumes: `parseOtpAttemptsLeft`, `parseOtpStrike`, `OTP_LOCKOUT_LIMIT` from `../../lib/otp` / `../lib/otp` (Task 7); 401/429 tokens from Task 6.
- Produces: visible copy on both mobile surfaces; no state changes beyond the existing `fail()` / `setError()` flows.

- [ ] **Step 1: Write the failing test** — in `auth-session.security.test.js`, inside SEC-AUTH-006, after the Task 6 test, add:

```js
  it('both mobile surfaces speak attempts, strikes, and the freeze', () => {
    const otpView = repo('mobile/components/otp/OtpVerificationView.jsx');
    expect(otpView).toMatch(/parseOtpAttemptsLeft\(message\)/);
    expect(otpView).toMatch(/parseOtpStrike\(message\)/);
    expect(otpView).toMatch(/attempt\$\{attemptsLeft === 1 \? "" : "s"\} left\./);
    expect(otpView).toMatch(/Strike \$\{strike\} of \$\{OTP_LOCKOUT_LIMIT\}\./);
    const login = repo('mobile/app/login.js');
    expect(login).toMatch(/parseOtpAttemptsLeft\(e\?\.message\)/);
    expect(login).toMatch(/parseOtpStrike\(e\?\.message\)/);
    expect(login).toMatch(/Strike \$\{strike\} of \$\{OTP_LOCKOUT_LIMIT\} — request a new code\./);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js
```
Expected: FAIL — no `parseOtpAttemptsLeft(message)` in the OTP view.

- [ ] **Step 3: Implement** — four edits:

(a) `mobile/components/otp/OtpVerificationView.jsx` import block (lines 18-30) — add `OTP_LOCKOUT_LIMIT,` after `OTP_CODE_DIGITS,` and add `parseOtpAttemptsLeft,` / `parseOtpStrike,` beside `parseOtpLock,`:

```js
import {
  OTP_CODE_DIGITS,
  OTP_LOCKOUT_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SUCCESS_HOLD_MS,
  OTP_TTL_SECONDS,
  OTP_VERIFY_MIN_MS,
  formatCountdown,
  formatLockWait,
  isEmailLike,
  maskEmailAddress,
  parseOtpAttemptsLeft,
  parseOtpLock,
  parseOtpStrike,
  sanitizeOtpInput,
} from "../../lib/otp";
```

(b) Same file, in the `catch` — after `const message = e?.message || "Verification failed. Please try again.";` (line 141) insert:

```js
        const attemptsLeft = parseOtpAttemptsLeft(message);
        const strike = parseOtpStrike(message);
```

then replace the `MFA_INVALID` branch (line 142-143) and keep the rest of the chain, so the chain reads:

```jsx
        if (message === "MFA_INVALID") {
          fail("Incorrect verification code.\nPlease check the code and try again.");
        } else if (attemptsLeft !== null) {
          fail(`Incorrect code.\n${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
        } else if (strike !== null) {
          const more = OTP_LOCKOUT_LIMIT - strike;
          fail(
            `That code was wrong. Strike ${strike} of ${OTP_LOCKOUT_LIMIT}.\n` +
              `${more} more failed code${more === 1 ? "" : "s"} will freeze this account for 15 minutes.`
          );
        } else if (message === "MFA_UNAVAILABLE") {
```
Everything after (`MFA_UNAVAILABLE`, `OTP_UNDELIVERABLE`, the existing `parseOtpLock` branch at line 152, connectivity, `MFA_REQUIRED`, generic `fail(message)`) stays exactly as it is.

(c) `mobile/app/login.js` line 27 — replace:
```js
import { formatLockWait, parseOtpLock } from "../lib/otp";
```
with:
```js
import { OTP_LOCKOUT_LIMIT, formatLockWait, parseOtpAttemptsLeft, parseOtpLock, parseOtpStrike } from "../lib/otp";
```

(d) Same file, in the `handleLogin` catch — after `const lockSecs = parseOtpLock(e?.message);` (line 196) insert:

```js
      const attemptsLeft = parseOtpAttemptsLeft(e?.message);
      const strike = parseOtpStrike(e?.message);
```

then replace the `MFA_INVALID` branch (lines 202-203) so the chain reads:

```js
      } else if (e.message === "MFA_INVALID") {
        setError("That verification code is invalid or already used.");
      } else if (attemptsLeft !== null) {
        setError(`Incorrect code — ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
      } else if (strike !== null) {
        const more = OTP_LOCKOUT_LIMIT - strike;
        setError(
          `That code was wrong. Strike ${strike} of ${OTP_LOCKOUT_LIMIT} — request a new code. ` +
            `${more} more failed code${more === 1 ? "" : "s"} will freeze this account for 15 minutes.`
        );
      } else if (e.message === "OTP_UNDELIVERABLE") {
```
The rest of the chain (`OTP_UNDELIVERABLE`, `lockSecs`, `MFA_UNAVAILABLE`, generic) stays as it is.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- src/security-assessment/auth-session.security.test.js mobile/lib/otp.test.js
```
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:ci -- mobile/components/otp/OtpVerificationView.jsx mobile/app/login.js src/security-assessment/auth-session.security.test.js
git add mobile/components/otp/OtpVerificationView.jsx mobile/app/login.js src/security-assessment/auth-session.security.test.js
git commit -m "feat(mobile): show attempts-left and strike warnings on OTP failures"
```

---

### Task 9: Full verification + vault documentation

**Files:**
- Modify: `Capstone/01 - System/System Overview.md` (changelog, after the 2026-09-25 lockout bullet at line 116)
- Modify: `Capstone/04 - Architecture/Authentication.md` (after the `account-level lockout` bullet, line 414)
- Modify: `Capstone/01 - System\Security Audit.md` (after the OTP lockout paragraph ending line 684)
- Modify: `Capstone/06 - Decisions/Decision Log.md` (append at end, line 321)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: green full suite, updated vault.

- [ ] **Step 1: Full suite**

```bash
npm run test:run
```
Expected: all green; counts ≥ baseline 208 files / 2557 tests (new tests were added — counts should rise, never fall).

- [ ] **Step 2: The existence-oracle invariant stays closed**

```bash
npm run test:run -- src/app/api/auth/login-status/route.test.js
```
Expected: PASS — "an active OTP lock produces no observable state".

- [ ] **Step 3: Lint every touched file**

```bash
npm run lint:ci -- src/lib/rate-limit.js src/lib/auth/email-otp.js src/lib/auth/otp-policy.js src/lib/auth.js "src/app/(auth)/login/page.js" src/app/api/mobile/auth/login/route.js src/security-assessment/auth-session.security.test.js src/lib/auth/email-otp.test.js mobile/lib/otp.js mobile/lib/otp.test.js mobile/components/otp/OtpVerificationView.jsx mobile/app/login.js
```
Expected: 0 warnings.

- [ ] **Step 4: Document in the vault**

(a) `Capstone/01 - System/System Overview.md` — insert a new changelog bullet **immediately after** the line beginning `- 2026-09-25: **account-level OTP lockout**`:

```markdown
- 2026-09-27: **OTP failure feedback** — a wrong code now answers with its cost: `OTP_ATTEMPTS_LEFT:<n>` after each miss ("Incorrect code — N attempt(s) left."), `OTP_STRIKE:<n>` when a challenge burns ("Strike n of 3 … N more failed codes will freeze this account for 15 minutes."), and on the 3rd burn the `OTP_LOCKED:<seconds>` countdown returns **immediately** instead of on the next submit — `rateLimit` gained `windowRetryAfter`, the window's true remainder counted from burn #1. Same three tokens on web (`auth.js` throw → MFA dialog) and mobile (401/429 → OTP view); parsers live in `otp-policy.js`, mirrored in `mobile/lib/otp.js` with parity pins. Counts derive from the challenge row and the DB-authoritative bucket; **`login-status` still reports no OTP state**. → [[Authentication]] · [[Decision Log]]
```

(b) `Capstone/04 - Architecture/Authentication.md` — insert after the line `existing \`account_locked\` security alert with \`details.factor: "otp"\`.` (end of the lockout bullet):

```markdown
- **Failure feedback (2026-09-27).** The lockout existed in silence: `auth.js`
  collapsed every wrong code to a bare `MFA_INVALID`, discarding the
  `attemptsRemaining`/`lockTripped` the backend computed. `verifyLoginChallenge`
  now numbers the struggle — `OTP_ATTEMPTS_LEFT:<n>` (attempts left in the
  challenge, 4..1) after each miss, `OTP_STRIKE:<n>` (burns recorded, 1..2)
  when a challenge burns, and the **3rd burn itself** throws
  `OTP_LOCKED:<seconds>` carrying `rateLimit`'s new `windowRetryAfter` (true
  window remainder from burn #1 — never a fresh 900). Web `authorize` throws
  the tokens; the mobile route answers 401 with them (429 for the freeze).
  Parsers `parseOtpAttemptsLeft`/`parseOtpStrike` are range-checked against
  `OTP_MAX_ATTEMPTS`/`OTP_LOCKOUT_LIMIT` and mirrored in `mobile/lib/otp.js`.
  The counts come from the challenge row and the DB-authoritative
  `lockout:otp` bucket — the client learns only the state of the challenge it
  already holds, the same information family as `ACCOUNT_LOCKED:<s>`. No new
  endpoint; `login-status` still reports no OTP state.
```

(c) `Capstone/01 - System\Security Audit.md` — insert after the paragraph ending `otp.test.js\` token-parity pins, full suite + touched-file lint green.`:

```markdown

**OTP failure feedback (2026-09-27, implemented):** the account-level lockout
was correct but silent — `auth.js` collapsed every wrong code to a bare
`MFA_INVALID`, discarding the `attemptsRemaining`/`lockTripped` it computed, so
a user could burn 9 codes seeing one identical message. Both channels now carry
`OTP_ATTEMPTS_LEFT:<n>` (4..1) per miss, `OTP_STRIKE:<n>` (1..2) per burn, and
an **instant** `OTP_LOCKED:<seconds>` on the 3rd burn — seconds =
`windowRetryAfter`, the window's true remainder from burn #1. Counts derive
from the challenge row and the `lockout:otp` bucket itself, never client
state; no new endpoint, and `login-status` still exposes no OTP state (the
existence-oracle ruling stands). Verified: email-otp outcome tests (strike
1/2/3, exact seconds), SEC-AUTH-006 pins (web/mobile mapping, both UIs),
`otp.test.js` parity pins, `login-status/route.test.js` green, full suite +
touched-file lint green.
```

(d) `Capstone/06 - Decisions/Decision Log.md` — append at the end of the file:

```markdown

**2026-09-27 — OTP failures speak their cost (attempts, strikes, instant freeze).**

- Tokens, not structured bodies: `NextAuth.authorize()` can only throw a
  message, so `OTP_ATTEMPTS_LEFT:<n>` / `OTP_STRIKE:<n>` ride the existing
  `ACCOUNT_LOCKED:<s>` / `OTP_LOCKED:<s>` convention; web and mobile parse
  them through mirrored, range-checked helpers.
- The 3rd burn answers with the countdown **immediately** — `rateLimit` gained
  `windowRetryAfter` because the SQL always computed the window remainder but
  zeroed it while `allowed`. A fresh 900 from now would overstate the wait (the
  window opened at burn #1), so the true remainder ships instead.
- Strike numbers come from `OTP_LOCKOUT_LIMIT - bucket.remaining` after the
  consume — the bucket is the DB-authoritative count, so the number shown can
  never drift from the number that locks, even under concurrent attempts.
- Still no OTP state in `/api/auth/login-status`: the existence-oracle ruling
  stands; the new tokens reveal only the state of a challenge the client
  already holds.

**Evidence:** `src/lib/rate-limit.js`, `src/lib/auth/email-otp.js`,
`src/lib/auth/otp-policy.js`, `src/lib/auth.js`,
`src/app/(auth)/login/page.js`, `src/app/api/mobile/auth/login/route.js`,
`mobile/lib/otp.js`, `mobile/app/login.js`,
`mobile/components/otp/OtpVerificationView.jsx`,
`docs/superpowers/specs/2026-09-27-otp-attempts-strikes-warning-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add "Capstone/01 - System/System Overview.md" "Capstone/04 - Architecture/Authentication.md" "Capstone/01 - System/Security Audit.md" "Capstone/06 - Decisions/Decision Log.md"
git commit -m "docs: record the OTP attempts/strike warning in the vault"
```

- [ ] **Step 6: Final review**

```bash
git log --oneline main..feat/otp-attempts-warning
git status --short
```
Expected: 9 commits, all conventional; working tree shows only the pre-existing unrelated dirt (nothing of ours unstaged).
