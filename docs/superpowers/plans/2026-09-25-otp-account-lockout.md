# Account-Level OTP Lockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SUPERSEDED IN PART (final review, 2026-09-25).** Everywhere this plan says
> `/api/auth/login-status` peeks the OTP bucket and answers `reason:"otp"`
> (Architecture above, Task 4, Task 5's client copy, Task 8's vault snippets) is
> **no longer true**. Task 4 was implemented and then **removed in final
> review**: resolving the email to an `employee_id` before answering makes
> `locked:true` a conditional account-existence oracle on a public, unthrottled
> endpoint while a lock stands. As built, login-status reports only the
> `account`/`ip` verdicts it had before; the OTP countdown ships solely in the
> direct `OTP_LOCKED:<sec>` token. The Task 4 body below is kept as the record
> of what was tried — treat its route/test snippets as historical.

**Goal:** Freeze an account's entire OTP surface (issue + verify, web + mobile + admin break-glass) for 15 minutes after 3 burned challenges, closing the `issue → 5 guesses → issue` loop.

**Architecture:** One choke point — `src/lib/auth/email-otp.js` peeks a `lockout:otp:${employeeId}` bucket in the existing `auth_rate_limits` table at the top of `issueLoginChallenge` and `verifyLoginChallenge`, spends one hit after the transaction commits when an outcome is `attempts_exhausted`, and clears the bucket on success. Both channels (`src/lib/auth.js`, `src/app/api/mobile/auth/login/route.js`) translate the new `otp_locked` reason into an `OTP_LOCKED:<seconds>` token; `/api/auth/login-status` peeks the bucket so the web form can show a countdown; clients render the wait with shared `parseOtpLock`/`formatLockWait` helpers.

**Tech Stack:** Next.js (web + API routes), Expo/React Native (mobile), Vitest, PostgreSQL `auth_rate_limits` via `@/lib/rate-limit` (migration 087 — **already exists**), ESLint.

**Spec:** `docs/superpowers/specs/2026-09-25-otp-account-lockout-design.md` (approved).

## Global Constraints

- **Lockout policy (exact):** `OTP_LOCKOUT_LIMIT = 3` burned challenges, `OTP_LOCKOUT_WINDOW_MS = 15 * 60_000` (fixed window from first burn), bucket key `` `lockout:otp:${employeeId}` ``.
- **Wire token (exact):** `` `OTP_LOCKED:<integer seconds>` `` — seconds only, never an email or account-existence fact (same invariant as the existing `ACCOUNT_LOCKED:<seconds>`).
- **No bypass (spec decision 4):** the lock applies to `login` **and** `break_glass` purposes, to issuing, verifying, the recovery-code fallback inside verify, and to `issueEmergencyCode`. The admin emergency-code endpoint answers 429 during the lock.
- **Unchanged:** `OTP_MAX_ATTEMPTS = 5`, `OTP_TTL_SECONDS = 300`, `OTP_RESEND_COOLDOWN_SECONDS = 60`, the email-mask formula (`otp-policy.js` `maskEmailAddress`), trusted-device behaviour, all existing 5/min credential and OTP buckets.
- **No schema work:** no migration, no `schema.sql` edit, no new table/view → `db:status`, `db:contract`, `verify:anon` are not in play (`auth_rate_limits` is already classified in `scripts/lib/schema-contract.mjs:81`).
- **Tests:** `npm run test:run` (Vitest; includes `src/**/*.test.js` and `mobile/lib/**/*.test.js` — **not** `src/app/**/page.js` nor `mobile/components/**`). Focused runs: `npx vitest run <file>`.
- **Lint:** `npx eslint <touched files> --max-warnings 0` (repo-wide baseline is 38 errors / 33 warnings, all pre-existing and outside touched files).
- **Commits:** one per task, conventional style (`feat(auth): …`, `feat(web): …`, `feat(mobile): …`, `docs: …`). The working tree contains unrelated dirty files — stage only the files each task touches.
- **Mock semantics you must know:** `vi.mock` factories are hoisted above imports (no imported bindings inside a factory — use literals); `vi.clearAllMocks()` (used in `beforeEach`) clears call data but **keeps** `vi.fn(impl)` implementations; `mockResolvedValueOnce` queues one override then falls back to the base impl.

---

### Task 1: Lockout constants + issue-side gate

**Files:**
- Modify: `src/lib/auth/otp-policy.js` (after `OTP_MAX_ATTEMPTS`, line ~30)
- Modify: `src/lib/auth/email-otp.js` (imports, two new exports, gate at top of `issueLoginChallenge`)
- Test: `src/lib/auth/email-otp.test.js`

**Interfaces:**
- Consumes: `peekRateLimit(key, {limit, windowMs}) → {allowed, remaining, retryAfter}` from `@/lib/rate-limit`.
- Produces (relied on by every later task):
  - `OTP_LOCKOUT_LIMIT = 3`, `OTP_LOCKOUT_WINDOW_MS = 900000` exported from `otp-policy.js`.
  - `otpLockoutKey(employeeId) → "lockout:otp:<id>"` and `checkOtpLockout(employeeId) → {allowed, remaining, retryAfter}` exported from `email-otp.js`.
  - `issueLoginChallenge(...)` now returns `{ ok: false, reason: "otp_locked", retryAfterSeconds: <number> }` when the bucket refuses, **before** touching the transaction.

- [ ] **Step 1: Write the failing test**

In `src/lib/auth/email-otp.test.js`:

1. Extend the imports — add to the `otp-policy` import block:

```js
import {
  OTP_BREAK_GLASS_TTL_SECONDS,
  OTP_LOCKOUT_LIMIT,
  OTP_LOCKOUT_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  describeOtpTtl,
  isDeliverableEmailAddress,
  maskEmailAddress,
} from "./otp-policy";
```

2. Add the limiter mock + limiter/db imports directly under the existing `vi.mock("@/lib/db", ...)` block (factories are hoisted — literals only inside them):

```js
// The account bucket is consulted by both entry points, so every test runs
// through an allowed-by-default limiter; a locked-state test overrides it once.
vi.mock("@/lib/rate-limit", () => ({
  peekRateLimit: vi.fn(async () => ({ allowed: true, remaining: 3, retryAfter: 0 })),
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 2, retryAfter: 0 })),
}));
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";
```

3. Change `beforeEach` to clear call data between tests:

```js
beforeEach(() => {
  txImpl = null;
  vi.clearAllMocks();
});
```

4. Add this test inside `describe("issueLoginChallenge", ...)` (e.g. after the cooldown test):

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: FAIL — `TypeError: Cannot read properties of null (reading 'query')` (no gate yet, so the issue path reaches the null `txImpl`), plus `OTP_LOCKOUT_LIMIT` import error until Step 3's constants exist. Either failure proves red.

- [ ] **Step 3: Implement**

In `src/lib/auth/otp-policy.js`, insert after `export const OTP_MAX_ATTEMPTS = 5;` (line 30):

```js
/**
 * Burned challenges allowed against one ACCOUNT before every code request and
 * verification is frozen for `OTP_LOCKOUT_WINDOW_MS`.
 *
 * The per-challenge ceiling above resets on each resend, so it alone cannot
 * stop a password holder looping `issue → 5 guesses → issue`; this is what
 * stops that loop. Three burns is 15 wrong codes per fixed window — against a
 * 10^6 space that is roughly one guess a minute.
 */
export const OTP_LOCKOUT_LIMIT = 3;

/** Fixed window, measured from the account's first burn inside it. */
export const OTP_LOCKOUT_WINDOW_MS = 15 * 60_000;
```

In `src/lib/auth/email-otp.js`:

1. Widen the imports:

```js
import { withTransaction } from "@/lib/db";
import { peekRateLimit } from "@/lib/rate-limit";
import {
  OTP_BREAK_GLASS_TTL_SECONDS,
  OTP_CODE_DIGITS,
  OTP_LOCKOUT_LIMIT,
  OTP_LOCKOUT_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from "@/lib/auth/otp-policy";
```

2. Add the two exports above `issueLoginChallenge` (after `ttlFor`/`normalizeCode` is fine — put them just before `export async function issueLoginChallenge`):

```js
/** Bucket for the account-level OTP lock. Keyed by id, never by email. */
export function otpLockoutKey(employeeId) {
  return `lockout:otp:${employeeId}`;
}

/**
 * Read-only: does NOT consume a hit. Fails closed — `peekRateLimit` answers
 * `allowed: false` when the limiter's table is unreachable.
 */
export async function checkOtpLockout(employeeId) {
  return peekRateLimit(otpLockoutKey(employeeId), {
    limit: OTP_LOCKOUT_LIMIT,
    windowMs: OTP_LOCKOUT_WINDOW_MS,
  });
}
```

3. Gate the top of `issueLoginChallenge` (before `let outcome;`), and extend its JSDoc return list with `| "otp_locked"`:

```js
export async function issueLoginChallenge({ employeeId, purpose = OTP_PURPOSE_LOGIN, ip, userAgent }) {
  // Account-level freeze: no code is minted — for either purpose — while the
  // lock stands. Checked before the transaction so a locked account does no
  // challenge work at all.
  const lock = await checkOtpLockout(employeeId);
  if (!lock.allowed) {
    return { ok: false, reason: "otp_locked", retryAfterSeconds: lock.retryAfter };
  }
  let outcome;
  await withTransaction(async (tx) => {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: PASS — the whole file (new test + every pre-existing issue/verify test now flowing through the allowed-by-default mock).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/otp-policy.js src/lib/auth/email-otp.js src/lib/auth/email-otp.test.js
git commit -m "feat(auth): freeze OTP issuance behind the account lockout"
```

---

### Task 2: Verify-side gate, burn consume, lockTripped, clear-on-success

**Files:**
- Modify: `src/lib/auth/email-otp.js` (gate at top of `verifyLoginChallenge`, post-commit consume/clear, JSDoc)
- Test: `src/lib/auth/email-otp.test.js`

**Interfaces:**
- Consumes: Task 1's `otpLockoutKey`, `checkOtpLockout`, `OTP_LOCKOUT_LIMIT`, `OTP_LOCKOUT_WINDOW_MS`; `rateLimit(key, {limit, windowMs}) → {allowed, remaining, retryAfter}`; `query(sql, params)` from `@/lib/db`.
- Produces (relied on by Tasks 3 and 6):
  - `verifyLoginChallenge(...)` returns `{ ok: false, reason: "otp_locked", retryAfterSeconds }` when locked, **before** any challenge query (recovery codes included).
  - An `attempts_exhausted` outcome additionally carries **`lockTripped: true`** — and only when the consume is the one that reaches the ceiling (`remaining === 0`). Ordinary outcomes are unchanged, so existing `toEqual` assertions stay green.
  - On `ok: true` (OTP **or** recovery), best-effort `DELETE FROM auth_rate_limits WHERE bucket_key = $1` with the bucket key.

- [ ] **Step 1: Write the failing tests**

Append to `describe("verifyLoginChallenge", ...)` in `src/lib/auth/email-otp.test.js` (imports/mocks already exist from Task 1):

```js
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
  vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: true, remaining: 0, retryAfter: 0 });
  const tx = makeTx([
    ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
  ]);
  txImpl = tx;

  const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
  expect(factor.lockTripped).toBe(true);
});

it("leaves lockTripped unset on a burn that still has room", async () => {
  const tx = makeTx([
    ["FROM email_otp_challenges", { rows: [loginChallengeRow({ attempts: OTP_MAX_ATTEMPTS - 1 })] }],
  ]);
  txImpl = tx;

  const factor = await verifyLoginChallenge({ employeeId: 8, authVersion: 3, code: "000000" });
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: FAIL — the locked test throws on the null tx (no gate yet); the consume tests see `rateLimit` never called; the clear tests see `query` never called with the DELETE.

- [ ] **Step 3: Implement**

In `src/lib/auth/email-otp.js`:

1. Widen the db import and the rate-limit import:

```js
import { query, withTransaction } from "@/lib/db";
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";
```

2. Gate + post-transaction handling in `verifyLoginChallenge` (update its JSDoc returns to `| "otp_locked"` and add `lockTripped?` to the exhausted case):

```js
export async function verifyLoginChallenge({ employeeId, authVersion, code }) {
  // Account-level freeze: verification — including the recovery-code fallback
  // inside it — does not run at all while the lock stands, and no attempt is
  // spent against a frozen account.
  const lock = await checkOtpLockout(employeeId);
  if (!lock.allowed) {
    return { ok: false, reason: "otp_locked", retryAfterSeconds: lock.retryAfter };
  }
  let outcome;
  await withTransaction(async (tx) => {
    // ...existing body untouched...
  });

  // Post-commit on purpose: `rateLimit` opens its own connection outside the
  // transaction, so consuming inside it would record a hit even if the tx
  // rolled back. One burned challenge is one hit — the burn consumes the
  // challenge, so this branch can fire at most once per challenge.
  if (outcome?.reason === "attempts_exhausted") {
    const bucket = await rateLimit(otpLockoutKey(employeeId), {
      limit: OTP_LOCKOUT_LIMIT,
      windowMs: OTP_LOCKOUT_WINDOW_MS,
    });
    // `allowed` is still true at the ceiling (hitCount <= limit); the trip is
    // signalled by there being no room left.
    if (bucket.remaining === 0) outcome.lockTripped = true;
  } else if (outcome?.ok === true) {
    // A proved sign-in starts the counter over (mirrors clearAccountLockout):
    // past struggle must not make the next typo half-way to a lock. Best-effort.
    try {
      await query("DELETE FROM auth_rate_limits WHERE bucket_key = $1", [otpLockoutKey(employeeId)]);
    } catch (error) {
      console.warn("clearOtpLockout failed:", error?.message || error);
    }
  }
  return outcome;
}
```

(The `withTransaction` body itself is **not** edited — the gate and the post-block are the only changes to this function.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: PASS — all new tests plus every pre-existing test (`attempts_exhausted` outcomes from older tests keep their exact `toEqual` shape because `lockTripped` is only set when the mocked consume reports `remaining: 0`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/email-otp.js src/lib/auth/email-otp.test.js
git commit -m "feat(auth): consume an account hit per burned OTP challenge"
```

---

### Task 3: Web server mapping (`src/lib/auth.js`) + SEC-AUTH-006 web pins

**Files:**
- Test: `src/security-assessment/auth-session.security.test.js` (append a new section after SEC-AUTH-005, ~line 413)
- Modify: `src/lib/auth.js` (otp-policy import line 9; `sendNewCode` ~line 186; verify block ~lines 219-245)

**Interfaces:**
- Consumes: Task 1's `otp_locked` issue outcome, Task 2's `otp_locked` verify outcome + `lockTripped`, `OTP_LOCKOUT_LIMIT`/`OTP_LOCKOUT_WINDOW_MS` from `otp-policy`, `raiseSecurityAlert` (already imported, line 12).
- Produces: thrown `Error("OTP_LOCKED:<seconds>")` from `authorize` for both the issue branch and the verify branch; an `account_locked` security alert with `details.factor: "otp"` on trip. Clients consume the token in Task 5.

- [ ] **Step 1: Write the failing test**

Append to `src/security-assessment/auth-session.security.test.js` (this file's tests read source text with the local `read()` helper — that IS this repo's test idiom for `auth.js`, which cannot be unit-driven):

```js
// ---------------------------------------------------------------------------
// SEC-AUTH-006 — the account-level OTP lockout
// ---------------------------------------------------------------------------

describe('SEC-AUTH-006 — burned codes freeze the account, not just the challenge', () => {
  it('the gate lives in the shared OTP layer, so both channels inherit it', () => {
    const issue = read('lib/auth/email-otp.js');
    expect(issue).toMatch(/checkOtpLockout\(employeeId\)/);
    expect(issue).toMatch(/reason: "otp_locked"/);
    expect(issue).toMatch(/reason === "attempts_exhausted"/);
  });

  it('the web channel maps otp_locked to the OTP_LOCKED token, retry-after only', () => {
    const web = read('lib/auth.js');
    expect(web).toMatch(/OTP_LOCKED:\$\{issued\.retryAfterSeconds\}/);
    expect(web).toMatch(/OTP_LOCKED:\$\{factor\.retryAfterSeconds\}/);
    // Same invariant as ACCOUNT_LOCKED: seconds and nothing else.
    expect(web).not.toMatch(/OTP_LOCKED:[^`]*email/);
  });

  it('the trip raises the existing account_locked alert with the OTP factor', () => {
    const web = read('lib/auth.js');
    expect(web).toMatch(/factor\.lockTripped/);
    expect(web).toMatch(/factor: "otp"/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/security-assessment/auth-session.security.test.js`
Expected: FAIL on `'the web channel maps otp_locked…'` and `'…alert with the OTP factor'` (`OTP_LOCKED` absent from `auth.js`). The shared-layer test already passes from Tasks 1-2.

- [ ] **Step 3: Implement in `src/lib/auth.js`**

1. Line 9 — widen the otp-policy import:

```js
import {
  isDeliverableEmailAddress,
  OTP_LOCKOUT_LIMIT,
  OTP_LOCKOUT_WINDOW_MS,
} from "@/lib/auth/otp-policy";
```

2. Inside `sendNewCode`, insert directly after the `if (issued?.ok) { … return "sent"; }` block (before the `break_glass_held` comment):

```js
            // The account is frozen after three burned codes: no code is
            // minted and the client is told how long to wait.
            if (issued?.reason === "otp_locked") {
              throw new Error(`OTP_LOCKED:${issued.retryAfterSeconds}`);
            }
```

3. After the `verifyLoginChallenge` try/catch (right before `if (!factor.ok) {`), raise the trip alert:

```js
          if (factor.lockTripped) {
            await raiseSecurityAlert(auditReq, {
              type: "account_locked",
              employeeId: employee.employee_id,
              details: {
                channel: "web",
                factor: "otp",
                burns: OTP_LOCKOUT_LIMIT,
                windowMinutes: OTP_LOCKOUT_WINDOW_MS / 60_000,
              },
            });
          }
```

4. Inside `if (!factor.ok) { … }`, after the existing `writeAudit` call and before `throw new Error("MFA_INVALID")`:

```js
            if (factor.reason === "otp_locked") {
              throw new Error(`OTP_LOCKED:${factor.retryAfterSeconds}`);
            }
```

(The `expired`/`stale` resend branch above the audit stays first — `otp_locked` never reaches it, because Task 2 returns before the challenge lookup.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/security-assessment/auth-session.security.test.js src/lib/auth/email-otp.test.js`
Expected: PASS — both files; also confirms no existing SEC-AUTH pin broke (ordering pins on `OTP_UNDELIVERABLE`, `trustedDevice`, `ACCOUNT_LOCKED` are untouched).

- [ ] **Step 5: Commit**

```bash
git add src/security-assessment/auth-session.security.test.js src/lib/auth.js
git commit -m "feat(auth): map the OTP account lock onto the web login path"
```

---

### Task 4: `/api/auth/login-status` reports the OTP lock

**Files:**
- Create: `src/app/api/auth/login-status/route.test.js`
- Modify: `src/app/api/auth/login-status/route.js`

**Interfaces:**
- Consumes: `checkOtpLockout(employeeId)` from Task 1, `query` from `@/lib/db`, existing `peekRateLimit`/`checkAccountLockout`.
- Produces: `GET` answers `{locked: true, retryAfterSec, reason: "otp"}` when the bucket refuses; `locked: false` otherwise (never reveals account existence — unchanged invariant, now covering the OTP bucket too). Task 5 renders `reason === "otp"`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/auth/login-status/route.test.js` (modelled on `src/app/api/auth/forgot-password/route.test.js`):

```js
// GET /api/auth/login-status — reports IP, account AND OTP locks with a
// countdown, and never reveals whether an account exists.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import { peekRateLimit } from "@/lib/rate-limit";
import { checkAccountLockout } from "@/lib/auth/account-lockout";
import { checkOtpLockout } from "@/lib/auth/email-otp";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  peekRateLimit: vi.fn(),
  clientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/auth/account-lockout", () => ({ checkAccountLockout: vi.fn() }));
vi.mock("@/lib/auth/email-otp", () => ({ checkOtpLockout: vi.fn() }));

const statusUrl = (email) =>
  `http://localhost/api/auth/login-status${email ? `?email=${encodeURIComponent(email)}` : ""}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(peekRateLimit).mockResolvedValue({ allowed: true, remaining: 5, retryAfter: 0 });
  vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(db.query).mockResolvedValue({ rows: [{ employee_id: 7 }] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/login-status", () => {
  it("reports an OTP account lock with its countdown", async () => {
    vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: false, retryAfter: 420 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 420, reason: "otp" });
    expect(checkOtpLockout).toHaveBeenCalledWith(7);
  });

  it("answers locked:false for an unknown account — never an oracle", async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] });

    const res = await GET(new Request(statusUrl("stranger@x.test")));

    expect(await res.json()).toMatchObject({ locked: false });
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("does not touch the employee table when no email is given", async () => {
    const res = await GET(new Request(statusUrl(null)));

    expect(await res.json()).toMatchObject({ locked: false });
    expect(db.query).not.toHaveBeenCalled();
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("still reports the password account lock first", async () => {
    vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: false, retryAfter: 500 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 500, reason: "account" });
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/auth/login-status/route.test.js`
Expected: FAIL — the current route never calls `checkOtpLockout`, so test 1 gets `{locked: false, …, reason: "ip"}` instead of the `otp` verdict.

- [ ] **Step 3: Implement**

Replace `src/app/api/auth/login-status/route.js` with:

```js
import { peekRateLimit, clientIp } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import { checkAccountLockout } from "@/lib/auth/account-lockout";
import { checkOtpLockout } from "@/lib/auth/email-otp";

// Public, read-only login-throttle status. NextAuth collapses every failed
// authorize() into the generic "CredentialsSignin" code client-side, which made
// a locked-out user see "Invalid email or password". The login page calls this
// after a failure to tell a rate-limited visitor the truth — including how long
// until they can retry. GET only; it never consumes a throttle hit.
//
// Query: ?email= (optional). When present, the per-account password lockout AND
// the account-level OTP lockout (`lockout:otp:<employee_id>`) are peeked too, so
// a frozen account gets its own countdown instead of the generic message. Only
// a locked state is ever revealed (locked:true + seconds); an unlocked or
// unknown account always answers locked:false, so the endpoint is not an
// account-existence oracle.
export async function GET(req) {
  const ip = clientIp(req);
  const email = new URL(req.url).searchParams.get("email") || "";
  const [ipBucket, lockout] = await Promise.all([
    peekRateLimit(`login:ip:${ip}`, { limit: 5, windowMs: 60_000 }),
    email ? checkAccountLockout(email) : Promise.resolve({ allowed: true, retryAfter: 0 }),
  ]);
  if (!lockout.allowed) {
    return Response.json({ locked: true, retryAfterSec: lockout.retryAfter, reason: "account" });
  }
  if (email) {
    const { rows } = await query(
      `SELECT employee_id FROM employees
        WHERE email = $1 AND deleted_at IS NULL AND status = 'Active'`,
      [email.toLowerCase().trim()]
    );
    if (rows[0]) {
      const otp = await checkOtpLockout(rows[0].employee_id);
      if (!otp.allowed) {
        return Response.json({ locked: true, retryAfterSec: otp.retryAfter, reason: "otp" });
      }
    }
  }
  return Response.json({ locked: !ipBucket.allowed, retryAfterSec: ipBucket.retryAfter, reason: "ip" });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/api/auth/login-status/route.test.js`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/login-status/route.js src/app/api/auth/login-status/route.test.js
git commit -m "feat(auth): login-status reports the OTP account lock"
```

---

### Task 5: Lock token helpers in `otp-policy` + web login page wiring

**Files:**
- Modify: `src/lib/auth/otp-policy.js` (add `OTP_LOCKED_PREFIX`, `parseOtpLock`, `formatLockWait` after `describeOtpTtl`, ~line 54)
- Test: `src/lib/auth/email-otp.test.js` (new describe, next to the existing `describeOtpTtl` describe at the file's end)
- Modify: `src/app/(auth)/login/page.js` (otp-policy import ~line 20; `handleMfaSubmit` :773 + catch :809-844; `handleResendCode` catch :867-891; `handleSubmit` catch :909-967; module scope near the top)

**Interfaces:**
- Consumes: the `OTP_LOCKED:<seconds>` tokens thrown by Task 3 (web) and returned by Task 6 (mobile, via `login-status` too).
- Produces:
  - `parseOtpLock(message) → number | null` — integer seconds from a `OTP_LOCKED:` token, `null` for anything else (including malformed seconds).
  - `formatLockWait(seconds) → "7 minutes" | "45 seconds" | "1 second"` (rounds up to whole minutes ≥ 60s).
  - Web: the login form freezes (`setLockSeconds`) with copy *"Too many incorrect codes. This account is temporarily locked. Try again in N minutes."* from all three catch sites and from the `login-status` `reason === "otp"` answer.
  - Task 7 mirrors both helpers into `mobile/lib/otp.js` and pins parity.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/auth/email-otp.test.js`, after the `describeOtpTtl` describe:

```js
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
```

Add `formatLockWait, parseOtpLock,` to the file's `otp-policy` import block.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: FAIL — `parseOtpLock is not a function` / import error.

- [ ] **Step 3: Implement the helpers**

In `src/lib/auth/otp-policy.js`, insert after `describeOtpTtl` (line 54):

```js
/** Wire prefix of the account-lock token both login channels speak. */
export const OTP_LOCKED_PREFIX = "OTP_LOCKED:";

/**
 * Seconds from an `OTP_LOCKED:<seconds>` token, or null for anything else.
 *
 * Copy belongs to the client, so the server sends only the number. A caller
 * branches on `parseOtpLock(message) !== null` — one helper decides both the
 * branch and the countdown, and a malformed token falls through to the caller's
 * generic message instead of a bogus wait.
 */
export function parseOtpLock(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_LOCKED_PREFIX)) return null;
  const seconds = Number(message.slice(OTP_LOCKED_PREFIX.length));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** "7 minutes" / "45 seconds" / "1 second" — the wait a locked-out user reads. */
export function formatLockWait(seconds) {
  const total = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;
  const minutes = Math.ceil(total / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Run to verify the helpers pass**

Run: `npx vitest run src/lib/auth/email-otp.test.js`
Expected: PASS — including every pre-existing test.

- [ ] **Step 5: Wire `src/app/(auth)/login/page.js`**

No unit test covers this file (Vitest's include list skips `src/app/**` pages) — verification here and in Step 6 is ESLint plus the full suite as regression.

1. Extend the otp-policy import (~line 20) with `formatLockWait, parseOtpLock,`.
2. Add at module scope (just above the component or beside the other module-level helpers):

```js
const otpLockMessage = (secs) =>
  `Too many incorrect codes. This account is temporarily locked. Try again in ${formatLockWait(secs)}.`;

function loginLockMessage(reason, secs) {
  if (reason === "otp") return otpLockMessage(secs);
  if (reason === "account")
    return "Too many incorrect attempts. This account is temporarily locked for your protection.";
  return "Too many login attempts from this network. Please wait a moment.";
}
```

3. `handleMfaSubmit` — freeze the step itself, line 773:

```js
  const handleMfaSubmit = async (submittedCode = mfaCode) => {
    if (loading || mfaStatus === "success" || lockSeconds > 0) return;
```

4. `handleMfaSubmit` catch — insert after the `TEMP_PASSWORD_EXPIRED` block (ends ~line 841), before the generic `setError("We couldn't verify that code…")`:

```js
      const otpLockSecs = parseOtpLock(err.message);
      if (otpLockSecs !== null) {
        setLockSeconds(otpLockSecs);
        setError(otpLockMessage(otpLockSecs));
        setMfaStatus("error");
        return;
      }
```

5. `handleResendCode` catch — insert after its `TEMP_PASSWORD_EXPIRED` block (~line 886), before the generic `setError("We couldn't send a new code…")`:

```js
      const otpLockSecs = parseOtpLock(err.message);
      if (otpLockSecs !== null) {
        setLockSeconds(otpLockSecs);
        setError(otpLockMessage(otpLockSecs));
        setMfaStatus("error");
        return;
      }
```

6. `handleSubmit` catch — insert after its `TEMP_PASSWORD_EXPIRED` block (~line 941), **before** the `// NextAuth collapses…` comment and the `login-status` fetch:

```js
      const otpLockSecs = parseOtpLock(err.message);
      if (otpLockSecs !== null) {
        setLockSeconds(otpLockSecs);
        setError(otpLockMessage(otpLockSecs));
        return;
      }
```

7. The `login-status` branch (~lines 951-959) — replace the `setError(...)` ternary with the helper (the `setLockSeconds(secs)` line above it stays):

```js
              if (status?.locked) {
                const secs = status.retryAfterSec || 60;
                setLockSeconds(secs);
                setError(loginLockMessage(status?.reason, secs));
                return;
              }
```

- [ ] **Step 6: Lint + regression**

Run:
```
npx eslint "src/app/(auth)/login/page.js" src/lib/auth/otp-policy.js src/lib/auth/email-otp.test.js --max-warnings 0
npx vitest run src/lib/auth/email-otp.test.js
```
Expected: lint exits 0; tests PASS. Also confirm the mask pins are untouched: `otp-policy.js` `maskEmailAddress` was not edited (Tasks added code, changed none).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/otp-policy.js src/lib/auth/email-otp.test.js "src/app/(auth)/login/page.js"
git commit -m "feat(web): lock token helpers and the frozen OTP step"
```

---

### Task 6: Mobile + admin emergency server mapping, SEC pins (mobile/admin)

**Files:**
- Test: `src/security-assessment/auth-session.security.test.js` (extend the SEC-AUTH-006 describe from Task 3)
- Modify: `src/app/api/mobile/auth/login/route.js` (otp-policy import line 17; module scope after imports; `sendNewCode` ~line 187; `if (!otpCode)` ~line 193; verify block ~lines 215-246)
- Modify: `src/app/api/auth/mfa/emergency-code/route.js` (~line 70, the `!issued?.ok` branch)

**Interfaces:**
- Consumes: Task 1/2 outcomes (`otp_locked` on issue **and** verify, `lockTripped`), `OTP_LOCKOUT_LIMIT`/`OTP_LOCKOUT_WINDOW_MS` from `otp-policy` (already imported for `isDeliverableEmailAddress`).
- Produces: `429 {error: "OTP_LOCKED:<seconds>"}` (+ `Retry-After` header) from the mobile login route on both issue and verify; `429` with human copy from the emergency-code endpoint; the trip alert with `factor: "otp"` on the mobile channel.

- [ ] **Step 1: Write the failing tests**

Append two tests inside the SEC-AUTH-006 describe in `src/security-assessment/auth-session.security.test.js`:

```js
  it('the mobile channel maps otp_locked and raises the same alert', () => {
    const mobile = read('app/api/mobile/auth/login/route.js');
    expect(mobile).toMatch(/issued\?\.reason === "otp_locked"/);
    expect(mobile).toMatch(/factor\.reason === "otp_locked"/);
    expect(mobile).toMatch(/OTP_LOCKED:\$\{[^}]+\}/);
    expect(mobile).toMatch(/factor\.lockTripped/);
    expect(mobile).toMatch(/factor: "otp"/);
  });

  it('the admin emergency path answers 429 with a wait, not a generic 500', () => {
    const emergency = read('app/api/auth/mfa/emergency-code/route.js');
    expect(emergency).toMatch(/issued\?\.reason === "otp_locked"/);
    expect(emergency).toMatch(/,\s*429\)/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/security-assessment/auth-session.security.test.js`
Expected: FAIL on both new tests (`otp_locked` absent from both sources).

- [ ] **Step 3: Implement the mobile route**

In `src/app/api/mobile/auth/login/route.js`:

1. Widen the otp-policy import (line 17):

```js
import {
  isDeliverableEmailAddress,
  OTP_LOCKOUT_LIMIT,
  OTP_LOCKOUT_WINDOW_MS,
} from "@/lib/auth/otp-policy";
```

2. Add a module-scope helper after the imports (above the `POST` docblock):

```js
// The account-level OTP lock, in the token form both clients parse. 429 +
// Retry-After so an intermediary honours the wait too.
const otpLockedResponse = (retryAfterSeconds) =>
  new Response(JSON.stringify({ error: `OTP_LOCKED:${retryAfterSeconds}` }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
```

3. Inside `sendNewCode`, insert directly after the `if (issued?.ok) { … return { ok: true, delivery: "sent" }; }` block, before the `break_glass_held` comment:

```js
      if (issued?.reason === "otp_locked") {
        return { ok: false, reason: "otp_locked", retryAfterSeconds: issued.retryAfterSeconds };
      }
```

4. In the `if (!otpCode)` block, replace `if (!delivery.ok) return err("MFA_UNAVAILABLE", 503);` with:

```js
      if (!delivery.ok) {
        if (delivery.reason === "otp_locked") {
          return otpLockedResponse(delivery.retryAfterSeconds);
        }
        return err("MFA_UNAVAILABLE", 503);
      }
```

5. After the `verifyLoginChallenge` try/catch (before `if (!factor.ok)`), raise the trip alert:

```js
    if (factor.lockTripped) {
      await raiseSecurityAlert(req, {
        type: "account_locked",
        employeeId: employee.employee_id,
        details: {
          channel: "mobile",
          factor: "otp",
          burns: OTP_LOCKOUT_LIMIT,
          windowMinutes: OTP_LOCKOUT_WINDOW_MS / 60_000,
        },
      });
    }
```

6. Inside `if (!factor.ok) { … }`, after the existing `writeAudit` call and before `return err("MFA_INVALID", 401);`:

```js
      if (factor.reason === "otp_locked") {
        return otpLockedResponse(factor.retryAfterSeconds);
      }
```

- [ ] **Step 4: Implement the emergency-code route**

In `src/app/api/auth/mfa/emergency-code/route.js`, inside `if (!issued?.ok) { … }`, insert after the `cooldown` branch and before `no_account`:

```js
      if (issued?.reason === "otp_locked") {
        // Decision: no break-glass bypass of the lock. The freeze is 15 minutes
        // and self-healing, so the operator waits rather than getting a second
        // rule to defend.
        const wait =
          issued.retryAfterSeconds >= 60
            ? `${Math.ceil(issued.retryAfterSeconds / 60)} minutes`
            : `${issued.retryAfterSeconds} seconds`;
        return err(
          `That account is temporarily locked after too many incorrect codes. Try again in ${wait}.`,
          429
        );
      }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/security-assessment/auth-session.security.test.js`
Expected: PASS — the whole file, new and pre-existing sections.

- [ ] **Step 6: Commit**

```bash
git add src/security-assessment/auth-session.security.test.js src/app/api/mobile/auth/login/route.js src/app/api/auth/mfa/emergency-code/route.js
git commit -m "feat(auth): mobile and emergency paths answer the OTP account lock"
```

---

### Task 7: Mobile client mirrors + OTP screen copy

**Files:**
- Modify: `mobile/lib/otp.js` (add the two helpers, after `sanitizeOtpInput`)
- Test: `mobile/lib/otp.test.js` (imports + two describes)
- Modify: `mobile/components/otp/OtpVerificationView.jsx` (otp import block ending line 28; `verifyWith` catch ~lines 136-165; `handleResend` catch ~lines 204-216)
- Modify: `mobile/app/login.js` (new import; `handleLogin` catch ~lines 56-72)

**Interfaces:**
- Consumes: Task 6's `OTP_LOCKED:<seconds>` errors (propagated by `mobile/lib/api.js` as `ApiError(body.error, 429)` — `e.message === "OTP_LOCKED:900"`), Task 5's server helpers for parity.
- Produces: mobile renders *"Too many incorrect codes. Try again in N minutes."* on verify, on resend, and on the initial send; `parseOtpLock`/`formatLockWait` mirrored in `mobile/lib/otp.js` with server-parity pins.

- [ ] **Step 1: Write the failing test**

In `mobile/lib/otp.test.js`:

1. Add to the `./otp` import: `formatLockWait, parseOtpLock,`.
2. Add to the server import block: `formatLockWait as serverFormatLockWait, parseOtpLock as serverParseOtpLock,`.
3. Append:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run mobile/lib/otp.test.js`
Expected: FAIL — `formatLockWait is not a function` (or import error) until the mirror exists.

- [ ] **Step 3: Implement the mirror**

Append to `mobile/lib/otp.js` (after `sanitizeOtpInput`), copying the server bodies verbatim — the parity test fails if they drift:

```js
/** Wire prefix of the account-lock token the server sends. Mirrors otp-policy. */
export const OTP_LOCKED_PREFIX = "OTP_LOCKED:";

/**
 * Seconds from an `OTP_LOCKED:<seconds>` token, or null for anything else.
 * Mirrors the server's parseOtpLock: one helper decides both the branch and
 * the countdown, and a malformed token falls through to the caller's generic
 * message instead of a bogus wait.
 */
export function parseOtpLock(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_LOCKED_PREFIX)) return null;
  const seconds = Number(message.slice(OTP_LOCKED_PREFIX.length));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** "7 minutes" / "45 seconds" / "1 second". Mirrors the server's formatLockWait. */
export function formatLockWait(seconds) {
  const total = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;
  const minutes = Math.ceil(total / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run mobile/lib/otp.test.js`
Expected: PASS — mirror pins + all pre-existing mask/TTL/cooldown pins.

- [ ] **Step 5: Wire the mobile UI**

1. `mobile/components/otp/OtpVerificationView.jsx` — add `formatLockWait, parseOtpLock,` to the import block that ends at line 28 (`} from "../../lib/otp";`).
2. In the `verifyWith` catch, insert after the `OTP_UNDELIVERABLE` branch (line ~149) and **before** the network branch (line ~150) — note `/network|connection|offline/i` would not match this copy, but order keeps the token check first anyway:

```js
        } else if (parseOtpLock(message) !== null) {
          fail(`Too many incorrect codes.\nTry again in ${formatLockWait(parseOtpLock(message))}.`);
        } else if (e?.status === 0 || /network|connection|offline/i.test(message)) {
```

3. In the `handleResend` catch (~line 207), insert **before** the existing `/cooldown|too many|wait/i` branch (that regex would otherwise swallow this copy and show the wrong message):

```js
      const lockSecs = parseOtpLock(message);
      if (lockSecs !== null) {
        setErrorMsg(`Too many incorrect codes. Try again in ${formatLockWait(lockSecs)}.`);
        setPhase("error");
      } else if (/cooldown|too many|wait/i.test(message)) {
```

4. `mobile/app/login.js` — add `import { formatLockWait, parseOtpLock } from "../lib/otp";` beside the other local imports. In the `handleLogin` catch, declare the parsed token at the top of the catch and add the branch after `OTP_UNDELIVERABLE` (line ~67):

```js
    } catch (e) {
      const lockSecs = parseOtpLock(e?.message);
      if (e.message === "MFA_REQUIRED") {
        // Valid credentials: the server has emailed a fresh 6-digit code.
        // The OTP step owns everything from here — no code field on this
        // form, no second tap after the code is complete.
        setMfaRequired(true);
      } else if (e.message === "MFA_INVALID") {
        setError("That verification code is invalid or already used.");
      } else if (e.message === "OTP_UNDELIVERABLE") {
        setError(
          "No verification code could be sent to this account. Contact your administrator."
        );
      } else if (lockSecs !== null) {
        setError(`Too many incorrect codes. Try again in ${formatLockWait(lockSecs)}.`);
      } else if (e.message === "MFA_UNAVAILABLE") {
```

(Keep the remaining branches and the final `else` exactly as they are.)

- [ ] **Step 6: Lint + regression**

Run:
```
npx eslint mobile/lib/otp.js mobile/lib/otp.test.js mobile/app/login.js mobile/components/otp/OtpVerificationView.jsx --max-warnings 0
npx vitest run mobile/lib
```
Expected: lint exits 0; all `mobile/lib` suites PASS (including `otp.test.js` mask-parity pins).

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/otp.js mobile/lib/otp.test.js mobile/app/login.js mobile/components/otp/OtpVerificationView.jsx
git commit -m "feat(mobile): surface the OTP account lock on the OTP screen"
```

---

### Task 8: Full verification + vault documentation

**Files:**
- Test: none new — full suite + lint as the gate
- Modify: `Capstone/04 - Architecture/Authentication.md` (OTP section, after the *"The hash is not the protection"* bullet, ~line 381)
- Modify: `Capstone/06 - Decisions/Decision Log.md` (append a dated entry at the end)
- Modify: `Capstone/01 - System/Security Audit.md` (append a paragraph in the Email OTP area)
- Modify: `Capstone/01 - System/System Overview.md` (append a changelog bullet after the 2026-09-24 line)
- Modify: `SYSTEM.md` (append a log paragraph at the end)

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: updated vault notes (mandatory per `.agents/AGENTS.md`) and a green repository.

- [ ] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: PASS (baseline was 203 files / 2484 tests on 2026-09-24; this plan adds 23 tests across 5 test files — `email-otp.test.js` +12, `login-status/route.test.js` +4, `otp.test.js` +2, `auth-session.security.test.js` +5 pins — so counts grow, no file may fail).

- [ ] **Step 2: Lint every touched file**

Run:
```
npx eslint src/lib/auth/otp-policy.js src/lib/auth/email-otp.js src/lib/auth/email-otp.test.js src/lib/auth.js src/security-assessment/auth-session.security.test.js src/app/api/auth/login-status/route.js src/app/api/auth/login-status/route.test.js "src/app/(auth)/login/page.js" src/app/api/mobile/auth/login/route.js src/app/api/auth/mfa/emergency-code/route.js mobile/lib/otp.js mobile/lib/otp.test.js mobile/app/login.js mobile/components/otp/OtpVerificationView.jsx --max-warnings 0
```
Expected: exit 0.

- [ ] **Step 3: Confirm no schema drift**

Run: `git status --short schema.sql supabase/migrations scripts/lib/schema-contract.mjs`
Expected: no output from this plan's work (pre-existing dirty entries unrelated to this plan may exist — verify none are new from these tasks; the plan created no migration and never opened `schema.sql`).

- [ ] **Step 4: Update `Capstone/04 - Architecture/Authentication.md`**

Insert as a new bullet immediately after the *"**The hash is not the protection, and the code says so.**"* bullet (which ends with `…dependency-free so the "use client" modal cannot drift from the server.`):

```markdown
- **Account-level lockout (2026-09-25).** The 5-attempt ceiling burns a *challenge*,
  and a resend mints a new one — so a password holder could loop
  `issue → 5 guesses → issue` forever. Now `issueLoginChallenge` and
  `verifyLoginChallenge` peek `lockout:otp:${employee_id}` in the existing
  `auth_rate_limits` table (migration 087 — no new table, no migration): after
  **3 burned challenges** the whole surface freezes for a **15-minute fixed
  window** — no code issued, no code verified, recovery codes refused, and the
  admin emergency-code path answers 429 (**no break-glass bypass**: the freeze is
  self-healing, so the operator waits rather than gaining a second rule to
  defend). The hit is spent **after** the verify transaction commits
  (`rateLimit` uses its own connection), one hit per burn; a successful OTP or
  recovery-code verification clears the bucket. Both channels speak the
  `OTP_LOCKED:<seconds>` token — web `authorize` throws it, the mobile route
  answers 429 with `Retry-After` — and `/api/auth/login-status?email=` peeks the
  bucket (locked state only, so it is still not an account-existence oracle) so
  the web form shows a live countdown. Policy constants live in `otp-policy.js`
  (`OTP_LOCKOUT_LIMIT`, `OTP_LOCKOUT_WINDOW_MS`); `parseOtpLock`/`formatLockWait`
  there are mirrored by `mobile/lib/otp.js` with parity pins. The trip raises the
  existing `account_locked` security alert with `details.factor: "otp"`.
```

- [ ] **Step 5: Update `Capstone/06 - Decisions/Decision Log.md`**

Append at the end of the file:

```markdown
## 2026-09-25 — The OTP attempt ceiling needed an account above it

**Decision:** freeze the whole OTP surface — issue, verify, recovery codes and
admin emergency codes, on web and mobile alike — for **15 minutes after 3 burned
challenges**, in the existing `auth_rate_limits` table.

The per-challenge ceiling (`OTP_MAX_ATTEMPTS = 5`) burns a challenge, but a
resend mints a fresh one after the 60-second cooldown, so an attacker holding a
valid password could loop `issue → 5 guesses → issue` indefinitely. Three burns
is 15 wrong codes per fixed window — roughly one guess a minute against a 10^6
space — while staying well clear of what a legitimate user produces by typing.

**Why the alternative was rejected.** Counting individual wrong codes (10 per
15 min) was rejected because 10 typos is only two bad codes for a user who keeps
getting fresh ones — the false-positive rate tracks carelessness, not attack.
2 burns / 30 minutes was rejected as harsher than the threat needs. A
break-glass bypass (admin emergency codes passing the lock) was rejected: the
window is 15 minutes and self-healing, so a bypass would buy no time worth a
second rule to defend — and the cost is accepted plainly: **an operator cannot
mint an emergency code for a locked account until the window expires.**

**Consequences taken on purpose:**

- Enforcement lives only in `email-otp.js`, the choke point both channels already
  call — a future third caller inherits the lock rather than forgetting it.
- The consume happens after the transaction commits, because `rateLimit` opens
  its own connection; a rolled-back verify must not spend a hit.
- A successful verification clears the bucket (mirrors `clearAccountLockout`),
  so past struggle never makes the next typo half-way to a lock.
- The limiter fails closed with everything else in `rate-limit.js`: a DB outage
  stops OTP — which it would anyway, since the challenge lives in the same DB.

**Evidence:** `src/lib/auth/email-otp.js`, `src/lib/auth/otp-policy.js`,
`src/lib/auth.js`, `src/app/api/mobile/auth/login/route.js`,
`src/app/api/auth/login-status/route.js`,
`src/app/api/auth/mfa/emergency-code/route.js`,
`docs/superpowers/specs/2026-09-25-otp-account-lockout-design.md`,
`Capstone/04 - Architecture/Authentication.md` §"Account-level lockout".
```

- [ ] **Step 6: Update `Capstone/01 - System/Security Audit.md`**

Append a paragraph in the Email OTP area (beside the other Email OTP entries):

```markdown
**Account-level OTP lockout (2026-09-25, implemented):** The 5-attempt ceiling
burned a *challenge*, not the account — re-submitting the form minted a new code
after the 60s cooldown, so a password holder could loop `issue → 5 guesses →
issue` at ~5 guesses/minute with no ceiling at all. Closed in the shared
`email-otp.js` choke point (both channels inherit it): 3 burned challenges in a
15-minute fixed window freeze issuing, verifying, the recovery-code fallback and
the admin emergency-code path (`OTP_LOCKED:<seconds>` token on web, 429 +
`Retry-After` on mobile), the hit is consumed post-commit one per burn, success
clears the bucket, the trip raises the `account_locked` alert with
`factor: "otp"`, and `/api/auth/login-status` peeks the bucket for the web
countdown (locked state only — still not an existence oracle). No migration —
`auth_rate_limits` from migration 087. Verified: `email-otp.test.js` lockout
cases, new `login-status/route.test.js`, SEC-AUTH-006 source pins, mobile
`otp.test.js` token-parity pins, full suite + touched-file lint green.
```

- [ ] **Step 7: Update `Capstone/01 - System/System Overview.md`**

Append after the last changelog bullet (the 2026-09-24 line):

```markdown
- 2026-09-25: **account-level OTP lockout** — 3 burned challenges in a 15-minute fixed window now freeze the entire OTP surface (issue, verify, recovery codes, admin emergency codes) on web *and* mobile, closing the `issue → 5 guesses → issue` loop the per-challenge ceiling could not stop. Enforced once in the shared `email-otp.js` choke point on the pre-existing `auth_rate_limits` bucket (no migration); `OTP_LOCKED:<seconds>` token with live countdown via `/api/auth/login-status`; success clears the bucket; trip raises the `account_locked` alert with `factor: "otp"`; **no break-glass bypass** — an operator waits out the 15 minutes. → [[Authentication]] · [[Decision Log]]
```

- [ ] **Step 8: Update root `SYSTEM.md`**

Append at the end of the file:

```markdown
**Account-level OTP lockout (2026-09-25):** The OTP per-challenge ceiling (5 attempts) reset on every resend, so a password holder could loop `issue → 5 guesses → issue` indefinitely. `issueLoginChallenge`/`verifyLoginChallenge` (the choke point both the NextAuth `authorize` path and `POST /api/mobile/auth/login` call) now peek `lockout:otp:<employee_id>` in the existing `auth_rate_limits` table: 3 burned challenges in a 15-minute fixed window freeze issuing, verifying, recovery codes and the admin emergency-code endpoint (no break-glass bypass — 429 with a wait). The hit is consumed after the verify transaction commits (one per burn), a successful verification clears the bucket, the trip raises the existing `account_locked` security alert with `details.factor: "otp"`, and `/api/auth/login-status` peeks the bucket so the web form shows a countdown. Wire token `OTP_LOCKED:<seconds>` parsed by `parseOtpLock`/`formatLockWait` in `otp-policy.js`, mirrored with parity pins in `mobile/lib/otp.js`. No migration, no schema change. Verification: `npm run test:run` green (new `email-otp.test.js` lockout cases, `login-status/route.test.js`, SEC-AUTH-006 source pins, mobile token-parity pins), touched-file ESLint `--max-warnings 0` clean.
```

- [ ] **Step 9: Commit**

```bash
git add "Capstone/04 - Architecture/Authentication.md" "Capstone/06 - Decisions/Decision Log.md" "Capstone/01 - System/Security Audit.md" "Capstone/01 - System/System Overview.md" SYSTEM.md
git commit -m "docs: record the account-level OTP lockout"
```

- [ ] **Step 10: Final verification report**

Run `npm run test:run` one last time and confirm exit 0. Report: files changed, test counts, and the one deliberate manual gap — the `.jsx`/page UI branches (web login page, `OtpVerificationView`, mobile `login.js`) are verified by ESLint + the token-parity unit tests, **not** by component tests (Vitest does not include them); a device/web run of a locked-out login is the acceptance step.
