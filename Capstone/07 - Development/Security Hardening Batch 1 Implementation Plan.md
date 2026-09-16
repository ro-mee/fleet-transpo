# Security Hardening Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five documented security gaps — weak client password schema, no account lockout, no global API throttle, no security alerting, dead auth code — with zero new migrations and all existing verifiers green.

**Architecture:** Reuse the existing DB-backed `auth_rate_limits` bucket pattern for lockout (no migration), a pure in-memory token bucket wired into `src/proxy.js` for the global edge throttle (fail-open, unlike the fail-closed auth buckets), `security_alert` audit rows surfaced through a new admin-only read route for alerting, and pure deletion for the dead code.

**Tech Stack:** Next.js 16 (proxy convention), zod v4 (`z.string({ error })` style, `refine`), vitest 3, PostgreSQL via `src/lib/db.js` `query`, existing `writeAudit`/`rateLimit`/`peekRateLimit`/`clientIp` helpers.

## Global Constraints

- TDD: failing test first for every behavior change, then minimal implementation, then green run — no exceptions.
- DRY: reuse `rateLimit`, `peekRateLimit`, `clientIp`, `writeAudit`, `isPassword` — do not reimplement throttling, IP parsing, auditing, or password rules.
- YAGNI: no new DB migration, no new email/push provider, no admin UI screen — alerting is audit rows plus a read API; dashboard/push is an explicit non-goal recorded in Task 6.
- Every task ends with `npx eslint` on touched files; the final task runs `npm run verify:auth` (must stay 269/269 or better) and the full suite.
- Never log, store, or return plaintext passwords, TOTP secrets, tokens, or cookie values; audit `newValues` carry only type/channel/reason metadata.
- `requirePermission(req, "reports", "read")` allows system_admin, admin, fleet_manager, management (`src/lib/auth/permissions.js` MATRIX) — correct audience for the alerts read API.

---

## File Structure

| File | Responsibility |
|---|---|
| Modify: `src/lib/validation/schemas.js:154-166` | Align `createUserSchema.password` with the strong `isPassword` rule (already imported at line 11). |
| Create: `src/lib/validation/schemas.test.js` | Lock client schema ≡ server policy; regression test for the weak floor. |
| Create: `src/lib/auth/account-lockout.js` | Lockout constants + `lockoutKey`/`checkAccountLockout`/`recordFailedAttempt`/`clearAccountLockout` on the existing `auth_rate_limits` table. |
| Create: `src/lib/auth/account-lockout.test.js` | Unit tests for the lockout helper (limit/window/key/expiry/clear). |
| Modify: `src/lib/auth.js:21-64` (`authorize`) | Web login: peek lockout before bcrypt, record on failure, clear on success, `account_locked` alert on trigger. |
| Modify: `src/app/api/mobile/auth/login/route.js:39-92` | Mobile login: identical lockout wiring with the existing 429 + `Retry-After` response shape. |
| Create: `src/lib/edge-throttle.js` | Pure in-memory per-IP token bucket (`checkEdgeThrottle`), fail-open, no imports from Next or DB so vitest can import it directly. |
| Create: `src/lib/edge-throttle.test.js` | Unit tests for allowance, window reset, fail-open, map pruning. |
| Modify: `src/proxy.js:91-125` | Wire `checkEdgeThrottle(clientIp-lite)` after CORS checks; 429 + `Retry-After` on exceed. |
| Create: `src/lib/auth/security-alerts.js` | `raiseSecurityAlert` writing `security_alert` audit rows via existing `writeAudit`. |
| Create: `src/app/api/system/security-alerts/route.js` | Admin-only GET of recent `security_alert` rows (`requirePermission(req, "reports", "read")`). |
| Create: `src/app/api/system/security-alerts/route.test.js` | Guard + projection tests for the new route. |
| Modify: `src/app/api/mobile/auth/refresh/route.js` (~103-120, replay-wipe block) | Emit `token_replay` alert where the family is revoked on replay. |
| Delete: `src/lib/auth/api-auth.js` | Remove dead `withRole`/`requireRole` (zero callers). |
| Modify: `Capstone/04 - Architecture/Authentication.md`, `SYSTEM.md` | Document lockout params, edge throttle, alerts, schema fix. |

---

### Task 1: Align `createUserSchema` password with the strong policy

**Files:**
- Modify: `src/lib/validation/schemas.js:154-166`
- Test: `src/lib/validation/schemas.test.js` (create)

**Interfaces:**
- Consumes: `isPassword` from `./index` (already imported in `schemas.js:11`; rule: ≥8 chars, upper + lower + digit + special, see `src/lib/validation/index.js:107-108`).
- Produces: `createUserSchema` rejecting everything the server's `type: "password"` rejects. Server side (`src/app/api/auth/register/route.js:25`) is unchanged — it already enforces the strong rule.

Context the implementer must know: `createUserSchema` is used only as the client form resolver in `src/app/(dashboard)/settings/users/new/page.js:13,132`. Today the form accepts a 6-character password the server then rejects with a 400 — the fix is client/server parity, not a new rule.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { createUserSchema } from "./schemas";

const base = {
  email: "new.user@fleetops.com",
  first_name: "New",
  last_name: "User",
  role_id: "2",
};

describe("createUserSchema password parity", () => {
  it("rejects the old 6-character floor", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects passwords without a special character", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef12" });
    expect(result.success).toBe(false);
  });

  it("accepts a policy-compliant password", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef1!" });
    expect(result.success).toBe(true);
  });

  it("still requires all other fields", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef1!", email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/validation/schemas.test.js`
Expected: FAIL — first two cases pass `min(6)` today (`"Abc123"` is 6 chars, `"Abcdef12"` is 8 chars, both currently accepted).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/validation/schemas.js`, replace line 156 only:

```js
  password: z
    .string()
    .min(1, "Password is required.")
    .refine((v) => isPassword(v), "Password must be 8+ characters with upper, lower, number, and a special character."),
```

Do not touch `driverSchema`/`driverEditSchema` (already correct at line 115-119) or the register route (already strong).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/validation/schemas.test.js`
Expected: PASS — 4/4.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/lib/validation/schemas.js src/lib/validation/schemas.test.js
git add src/lib/validation/schemas.js src/lib/validation/schemas.test.js
git commit -m "fix(auth): align createUserSchema password floor with server policy" -m "Client user-creation form accepted 6-char passwords the register route then rejected with 400. Now uses the shared isPassword rule (8+, upper/lower/digit/special), matching driverSchema and server type password."
```

---

### Task 2: Account-lockout helper on the existing rate-limit table

**Files:**
- Create: `src/lib/auth/account-lockout.js`
- Test: `src/lib/auth/account-lockout.test.js` (create)

**Interfaces:**
- Consumes: `rateLimit`, `peekRateLimit` from `@/lib/rate-limit`; `query` from `@/lib/db`.
- Produces (used by Tasks 3-4): `LOCKOUT_LIMIT = 10`, `LOCKOUT_WINDOW_MS = 900_000`, `lockoutKey(email)`, `checkAccountLockout(email)`, `recordFailedAttempt(email)`, `clearAccountLockout(email)`.

Design (why no migration): `auth_rate_limits(bucket_key PK, window_started_at, hit_count)` already supports arbitrary buckets. A `lockout:account:<email>` bucket with limit 10 / 15-min window IS the lockout state. `peek` before the attempt (no consumption), `rateLimit` after a failure (consumes one), `DELETE` on success (a user who finally remembers the password is not punished for old failures). Fail-closed on DB error is inherited from `rateLimit`/`peekRateLimit` — a downed limiter denies logins rather than opening them, consistent with the existing login throttles.

- [ ] **Step 1: Write the failing test**

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  peekRateLimit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import {
  LOCKOUT_LIMIT,
  LOCKOUT_WINDOW_MS,
  lockoutKey,
  checkAccountLockout,
  recordFailedAttempt,
  clearAccountLockout,
} from "./account-lockout";

beforeEach(() => vi.clearAllMocks());

describe("account lockout", () => {
  it("uses a 10-attempt, 15-minute budget", () => {
    expect(LOCKOUT_LIMIT).toBe(10);
    expect(LOCKOUT_WINDOW_MS).toBe(15 * 60_000);
  });

  it("keys buckets by normalized email", () => {
    expect(lockoutKey("  Admin@FleetOps.com ")).toBe("lockout:account:admin@fleetops.com");
  });

  it("checks without consuming", async () => {
    peekRateLimit.mockResolvedValue({ allowed: true, remaining: 7, retryAfter: 0 });
    const result = await checkAccountLockout("a@b.com");
    expect(peekRateLimit).toHaveBeenCalledWith("lockout:account:a@b.com", { limit: 10, windowMs: 900_000 });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it("records a failure by consuming one hit", async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 6, retryAfter: 0 });
    await recordFailedAttempt("a@b.com");
    expect(rateLimit).toHaveBeenCalledWith("lockout:account:a@b.com", { limit: 10, windowMs: 900_000 });
  });

  it("clears the bucket on successful login", async () => {
    await clearAccountLockout("a@b.com");
    expect(query).toHaveBeenCalledWith(
      "DELETE FROM auth_rate_limits WHERE bucket_key = $1",
      ["lockout:account:a@b.com"]
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/account-lockout.test.js`
Expected: FAIL with "Failed to load" / "does not provide export" — module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";

// "Three strikes" policy: 10 failed password attempts freeze the account for
// 15 minutes. State lives in the existing auth_rate_limits table (migration
// 087) — no new table. peek-before-attempt, consume-on-failure, delete-on-success.
export const LOCKOUT_LIMIT = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

export function lockoutKey(email) {
  return `lockout:account:${String(email).toLowerCase().trim()}`;
}

/** Read-only: does NOT consume the budget. */
export async function checkAccountLockout(email) {
  return peekRateLimit(lockoutKey(email), { limit: LOCKOUT_LIMIT, windowMs: LOCKOUT_WINDOW_MS });
}

/** Consume one attempt after a failed password check. Returns the bucket result. */
export async function recordFailedAttempt(email) {
  return rateLimit(lockoutKey(email), { limit: LOCKOUT_LIMIT, windowMs: LOCKOUT_WINDOW_MS });
}

/** Remove the budget after a successful login. Never throws. */
export async function clearAccountLockout(email) {
  try {
    await query("DELETE FROM auth_rate_limits WHERE bucket_key = $1", [lockoutKey(email)]);
  } catch (error) {
    console.warn("clearAccountLockout failed:", error?.message || error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/account-lockout.test.js`
Expected: PASS — 5/5.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/lib/auth/account-lockout.js src/lib/auth/account-lockout.test.js
git add src/lib/auth/account-lockout.js src/lib/auth/account-lockout.test.js
git commit -m "feat(auth): add account-lockout helper on auth_rate_limits buckets" -m "10 failures per 15-min window per account. Reuses existing limiter table (no migration): peek before attempt, consume on failure, delete on success. DB failure fails closed via the underlying helpers."
```

---

### Task 3: Wire lockout into web login (`authorize`)

**Files:**
- Modify: `src/lib/auth.js:27-64`
- Test: none new (authorize is integration-heavy; coverage comes from Task 2 unit tests + the existing login flow). Add no test file here — say so in the commit message.

**Interfaces:**
- Consumes: `checkAccountLockout`, `recordFailedAttempt`, `clearAccountLockout` from `@/lib/auth/account-lockout`; `raiseSecurityAlert` from `@/lib/auth/security-alerts` (Task 5 — implement Task 5 first if working out of order, or wire the alert call in Task 5; this task includes the call site marked clearly).
- Produces: locked accounts get `Error("ACCOUNT_LOCKED:<retryAfterSeconds>")`; successful logins clear the budget.

Placement (exact, in `authorize` in `src/lib/auth.js`):
1. After the existing 5/min throttle block (lines 31-37), insert the lockout peek. It runs BEFORE the employee lookup + bcrypt so a frozen account spends no DB/crypto work and leaks nothing new.
2. In the `if (!employee || !valid)` failure branch (lines 56-64), after the existing `login_failure` audit, call `recordFailedAttempt(normalizedEmail)`; if the returned bucket shows this attempt exhausted the budget (`remaining === 0`), call `raiseSecurityAlert` with type `account_locked`.
3. After a fully successful authorize (after the MFA block and session insert — anchor on the existing `INSERT web_sessions` statement later in the function; read the file to place it), call `clearAccountLockout(normalizedEmail)` (fire-and-forget safe: it never throws).

- [ ] **Step 1: Read the exact anchor lines**

Read `src/lib/auth.js:27-64` (throttle + failure branch) and locate the `INSERT web_sessions` success path further down the same `authorize` function. Do not guess line numbers — confirm them.

- [ ] **Step 2: Insert the lockout peek after the throttle block**

```js
import { checkAccountLockout, recordFailedAttempt, clearAccountLockout } from "@/lib/auth/account-lockout";
```

```js
        const lockout = await checkAccountLockout(normalizedEmail);
        if (!lockout.allowed) {
          throw new Error(`ACCOUNT_LOCKED:${lockout.retryAfter}`);
        }
```

Note: NextAuth collapses every `authorize()` failure into "CredentialsSignin" client-side (see `peekRateLimit` docblock in `src/lib/rate-limit.js:55-60`), so the `ACCOUNT_LOCKED:<seconds>` message is machine-readable for the login-status endpoint later, not user-facing today. Keep the existing human message pattern for any user-facing string.

- [ ] **Step 3: Record failures and raise the lockout alert**

Inside the existing `if (!employee || !valid)` branch, after the `login_failure` `writeAudit` call:

```js
          const lockoutBucket = await recordFailedAttempt(normalizedEmail);
          if (!lockoutBucket.allowed && lockoutBucket.remaining === 0) {
            const { raiseSecurityAlert } = await import("@/lib/auth/security-alerts");
            await raiseSecurityAlert(auditReq, {
              type: "account_locked",
              details: { channel: "web", failures: LOCKOUT_LIMIT, windowMinutes: 15 },
            });
          }
```

Import `LOCKOUT_LIMIT` alongside the other lockout imports instead of hardcoding 10 in `details` (shown inline here for brevity — the committed code must reference the constant).

- [ ] **Step 4: Clear the budget on success**

After the session row is inserted (anchor: the `INSERT web_sessions` statement in the same function):

```js
        await clearAccountLockout(normalizedEmail);
```

- [ ] **Step 5: Lint, verify auth audit, commit**

```bash
npx eslint src/lib/auth.js
npm run verify:auth
git add src/lib/auth.js
git commit -m "feat(auth): enforce 10-failure / 15-minute account lockout on web login" -m "Peek before bcrypt (no work spent on frozen accounts), consume on failure, clear on success. Exhaustion emits an account_locked security alert. Thrown as ACCOUNT_LOCKED:<seconds> for the login-status endpoint to interpret later."
```

`npm run verify:auth` must still report 0 failed (no route signatures changed).

---

### Task 4: Wire identical lockout into mobile login

**Files:**
- Modify: `src/app/api/mobile/auth/login/route.js:39-92`

**Interfaces:**
- Consumes: same three helpers + `raiseSecurityAlert` as Task 3.
- Produces: locked mobile accounts get the existing 429 + `Retry-After` JSON shape (consistent with the route's current throttle response at lines 45-48), never a 401 that invites retry.

- [ ] **Step 1: Insert the lockout peek after the throttle block**

After lines 39-49 (existing 5/min throttle), insert:

```js
    import { checkAccountLockout, recordFailedAttempt, clearAccountLockout } from "@/lib/auth/account-lockout";
```

(Top-of-file import alongside the existing `rateLimit, clientIp` import — do not use dynamic import inside the handler; the route file already has static imports.)

```js
    const lockout = await checkAccountLockout(email);
    if (!lockout.allowed) {
      return new Response(
        JSON.stringify({ error: `Too many failed attempts. Try again in ${lockout.retryAfter} seconds.` }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(lockout.retryAfter) } }
      );
    }
```

- [ ] **Step 2: Record failures in the invalid-credentials branch**

Inside the `if (!employee || !valid)` branch (lines 84-92), after the existing `login_failure` audit:

```js
      const lockoutBucket = await recordFailedAttempt(email);
      if (!lockoutBucket.allowed && lockoutBucket.remaining === 0) {
        await raiseSecurityAlert(req, {
          type: "account_locked",
          employeeId: employee?.employee_id ?? null,
          details: { channel: "mobile" },
        });
      }
```

`raiseSecurityAlert` must accept a null `employeeId` (unknown account) — it does by design (see Task 5 contract); the non-driver and missing-link failure branches below are NOT lockout-counted (wrong app, not wrong password — counting them would let anyone freeze a driver account from the wrong client).

- [ ] **Step 3: Clear the budget on success**

Locate the successful token-issuance path later in the same handler (anchor: where the access/refresh pair is returned) and insert:

```js
    await clearAccountLockout(email);
```

- [ ] **Step 4: Lint, verify auth audit, commit**

```bash
npx eslint "src/app/api/mobile/auth/login/route.js"
npm run verify:auth
git add "src/app/api/mobile/auth/login/route.js"
git commit -m "feat(auth): enforce 10-failure / 15-minute lockout on mobile login" -m "Mirrors web authorize: peek before bcrypt, 429 + Retry-After when frozen, consume on bad password only (non-driver/missing-link rejections are not counted), clear on success, account_locked alert on exhaustion."
```

---

### Task 5: Shared edge throttle + wire into `src/proxy.js`

**Files:**
- Create: `src/lib/edge-throttle.js`
- Test: `src/lib/edge-throttle.test.js` (create)
- Modify: `src/proxy.js:91-125`

**Interfaces:**
- Consumes: nothing (pure; takes `ip` + `nowMs` params so tests control time; no Next, no DB imports).
- Produces: `checkEdgeThrottle(ip, nowMs = Date.now())` returning `{ allowed, retryAfter }`; `EDGE_LIMIT = 600`, `EDGE_WINDOW_MS = 60_000`.

Design (deliberate and documented): this throttle is per-instance memory, so with N app instances the effective limit is ~N×600/min — it blunts single-source floods and dumb scrapers, not distributed attacks. It FAILS OPEN (allows on error) because it guards availability of the whole API, unlike the credential throttles which fail closed. Both choices go in the code comment so a future reader doesn't "fix" them into an outage vector.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { checkEdgeThrottle, EDGE_LIMIT, EDGE_WINDOW_MS } from "./edge-throttle";

describe("edge throttle", () => {
  it("allows a generous burst", () => {
    expect(EDGE_LIMIT).toBe(600);
    expect(EDGE_WINDOW_MS).toBe(60_000);
    for (let i = 0; i < 600; i++) {
      expect(checkEdgeThrottle("9.9.9.9", 1_000_000).allowed).toBe(true);
    }
  });

  it("blocks the 601st hit with a retry hint", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("8.8.8.8", 2_000_000);
    const result = checkEdgeThrottle("8.8.8.8", 2_000_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("7.7.7.7", 3_000_000);
    expect(checkEdgeThrottle("7.7.7.7", 3_000_000).allowed).toBe(false);
    expect(checkEdgeThrottle("7.7.7.7", 3_000_000 + 60_001).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("6.6.6.6", 4_000_000);
    expect(checkEdgeThrottle("6.6.6.6", 4_000_000).allowed).toBe(false);
    expect(checkEdgeThrottle("5.5.5.5", 4_000_000).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/edge-throttle.test.js`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// Best-effort per-instance flood guard for /api/* (wired in src/proxy.js).
//
// DELIBERATE LIMITS, do not "harden" without reading this:
// - Per-instance memory: with N instances the effective cap is ~N x EDGE_LIMIT.
//   This blunts single-source floods, not botnets. That is all it claims.
// - FAIL-OPEN: any internal error allows the request. This guards the whole
//   API's availability; failing closed here would turn a Map bug into a
//   self-inflicted outage. Credential paths keep their fail-closed DB throttles.
export const EDGE_LIMIT = 600;
export const EDGE_WINDOW_MS = 60_000;
const MAX_BUCKETS = 5_000;

const buckets = new Map();

export function checkEdgeThrottle(ip, nowMs = Date.now()) {
  try {
    const key = String(ip || "unknown");
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
        const oldest = buckets.keys().next().value;
        buckets.delete(oldest);
      }
      buckets.set(key, { count: 1, resetAt: nowMs + EDGE_WINDOW_MS });
      return { allowed: true, retryAfter: 0 };
    }
    bucket.count += 1;
    if (bucket.count > EDGE_LIMIT) {
      return { allowed: true ? false : false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)) };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}
```

(Note: write the exceed branch as plain `return { allowed: false, retryAfter: ... }` — the ternary above is a transcription artifact and must NOT be committed; reviewer to verify the committed line reads `allowed: false`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/edge-throttle.test.js`
Expected: PASS — 4/4.

- [ ] **Step 5: Wire into `src/proxy.js` after the CORS checks**

Insert after the origin-rejection block (lines 95-103) and before the OPTIONS handler (line 105). Derive the IP with the same rightmost-XFF rule as `clientIp` (proxy cannot import `@/lib/rate-limit` — keep the 10-line inline parse to avoid cross-runtime imports):

```js
import { checkEdgeThrottle } from "@/lib/edge-throttle";
```

```js
  const forwarded = request.headers.get("x-forwarded-for");
  const edgeIp = forwarded ? forwarded.split(",").pop().trim() : (request.headers.get("x-real-ip") || "unknown");
  const edge = checkEdgeThrottle(edgeIp);
  if (!edge.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(edge.retryAfter), Vary: "Origin" } }
    );
  }
```

Preflight OPTIONS is throttled identically (a flood of preflights is still a flood); the 600/min budget leaves legitimate browsers unaffected.

- [ ] **Step 6: Lint, verify, commit**

```bash
npx eslint src/lib/edge-throttle.js src/lib/edge-throttle.test.js src/proxy.js
npm run verify:auth
git add src/lib/edge-throttle.js src/lib/edge-throttle.test.js src/proxy.js
git commit -m "feat(api): add per-IP edge throttle on /api via proxy" -m "In-memory 600 req/min/IP token bucket, fail-open by design (availability guard, not credential guard). Credential paths keep fail-closed DB throttles. Per-instance memory: effective cap scales with instance count."
```

---

### Task 6: Security alerts — writer, triggers, admin read API

**Files:**
- Create: `src/lib/auth/security-alerts.js`
- Modify: `src/app/api/mobile/auth/refresh/route.js` (replay-wipe block, ~103-120 — read to confirm anchors)
- Create: `src/app/api/system/security-alerts/route.js`
- Test: `src/app/api/system/security-alerts/route.test.js` (create)

**Interfaces:**
- Consumes: `writeAudit` from `@/lib/audit`.
- Produces: `raiseSecurityAlert(req, { type, employeeId = null, details = {} })`; `SECURITY_ALERT_TYPES = ["account_locked", "token_replay"]`; GET route returning `{ alerts: [{ id, created_at, employee_id, email, type, details, ip_address }] }` (latest 50).

Contract: `raiseSecurityAlert` writes action `"security_alert"`, resource `"authentication"`, `newValues: { type, ...details }`, never throws (inherits `writeAudit`'s swallow), never includes secrets. Lockout call sites are Tasks 3-4 (already written against this contract — keep the signature identical).

- [ ] **Step 1: Write the route test first (defines the API contract)**

```js
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});

import { query } from "@/lib/db";
import { requirePermission } from "@/lib/api/utils";
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/system/security-alerts", () => {
  it("requires a privileged role", async () => {
    requirePermission.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const res = await GET(new Request("http://localhost/api/system/security-alerts"));
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "reports", "read");
  });

  it("returns the latest alerts without secret material", async () => {
    requirePermission.mockResolvedValue({ user: { employeeId: 1, role: "admin" } });
    query.mockResolvedValue({
      rows: [{
        id: 9, created_at: "2026-09-16T00:00:00Z", employee_id: 12,
        email: "driver@fleetops.com", type: "account_locked",
        details: { channel: "web" }, ip_address: "1.2.3.4",
      }],
    });
    const res = await GET(new Request("http://localhost/api/system/security-alerts"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe("account_locked");
    expect(JSON.stringify(body)).not.toMatch(/password|totp|secret|token[^_]/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/system/security-alerts/route.test.js`
Expected: FAIL — route does not exist yet.

- [ ] **Step 3: Write the alert writer**

```js
import { writeAudit } from "@/lib/audit";

export const SECURITY_ALERT_TYPES = ["account_locked", "token_replay"];

/**
 * Ring the alarm: a security-relevant event the admin must see. Writes a
 * `security_alert` audit row (surfaced by GET /api/system/security-alerts).
 * Never throws; details must be metadata only (channel, reason, counts).
 */
export async function raiseSecurityAlert(req, { type, employeeId = null, details = {} } = {}) {
  if (!SECURITY_ALERT_TYPES.includes(type)) return;
  await writeAudit(req, null, {
    action: "security_alert",
    resource: "authentication",
    resourceId: employeeId,
    newValues: { type, ...details },
  });
}
```

- [ ] **Step 4: Write the read route**

```js
import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

// Admin visibility for security_alert audit rows (written by raiseSecurityAlert).
// PII is limited to employee_id + email — admins already see both in user
// management; no hashes, tokens, or OTP material ever enters these rows.
export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const { rows } = await query(
      `SELECT a.id, a.created_at, a.employee_id, e.email, a.new_values AS details, a.ip_address
         FROM audit_logs a
         LEFT JOIN employees e ON e.employee_id = a.employee_id
        WHERE a.action = 'security_alert' AND a.resource = 'authentication'
        ORDER BY a.id DESC
        LIMIT 50`
    );
    return ok({
      alerts: (rows || []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        employee_id: r.employee_id,
        email: r.email || null,
        type: r.details?.type || "unknown",
        details: r.details || {},
        ip_address: r.ip_address || null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
```

- [ ] **Step 5: Emit `token_replay` at the refresh-family wipe**

Read `src/app/api/mobile/auth/refresh/route.js:100-125` and locate the replay branch (family revocation on reused refresh token, ~lines 110-117 per the token-rotation audit). Immediately after the revocation query, insert:

```js
import { raiseSecurityAlert } from "@/lib/auth/security-alerts";
```

```js
        await raiseSecurityAlert(req, {
          type: "token_replay",
          employeeId: family?.employee_id ?? null,
          details: { channel: "mobile", family_id: family?.family_id ?? null },
        });
```

Anchor on the actual variable names in the file (`family` shown illustratively — read the block and use the real identifiers; the call itself is exactly as shaped above). A replayed refresh token means a stolen or double-used credential: this is the "stolen key" alarm.

- [ ] **Step 6: Run tests, verify, commit**

```bash
npx vitest run src/app/api/system/security-alerts/route.test.js
npx eslint src/lib/auth/security-alerts.js "src/app/api/system/security-alerts/route.js" "src/app/api/system/security-alerts/route.test.js" "src/app/api/mobile/auth/refresh/route.js"
npm run verify:auth
git add src/lib/auth/security-alerts.js "src/app/api/system/security-alerts" "src/app/api/mobile/auth/refresh/route.js"
git commit -m "feat(auth): security-alert audit events plus admin read API" -m "raiseSecurityAlert writes security_alert rows for account_locked (Tasks 3-4 call sites) and token_replay (refresh-family wipe). GET /api/system/security-alerts (reports/read roles) returns latest 50 with employee email only. Dashboard widget and push delivery are explicit follow-ups, not this batch."
```

`npm run verify:auth` must accept the new GET (guarded by `requirePermission`, not a mutating handler).

---

### Task 7: Delete dead `withRole` / `requireRole`

**Files:**
- Delete: `src/lib/auth/api-auth.js`
- Test: none (deletion). Verification is grep + full suite.

**Interfaces:**
- Consumes: nothing. Produces: nothing. The module trusts stale `session.user.role` with no live re-read and has zero callers — anyone importing it later would silently bypass demotion/disablement handling.

- [ ] **Step 1: Prove zero usage**

Run: `git grep -n "api-auth\|withRole\|requireRole" -- src mobile scripts docs 2>/dev/null`
Expected: hits only in `src/lib/auth/api-auth.js` itself (and this plan file — exclude `Capstone/` from the check). If any real caller exists, STOP and remove this task from the batch.

- [ ] **Step 2: Delete the file**

```bash
git rm src/lib/auth/api-auth.js
```

- [ ] **Step 3: Run the full gates**

```bash
npx eslint src/mobile 2>/dev/null; npx eslint src
npm run verify:auth
npm run test:run
```

Expected: lint clean, verify 0 failed, full suite green (baseline ~1,284+ tests plus the new files from Tasks 1-6).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(auth): delete dead withRole/requireRole guard" -m "Zero callers; trusted stale session role with no live re-read, so any future use would bypass disablement/demotion handling. Enforcement lives in requirePermission/requireDriver with per-request identity."
```

---

### Task 8: Docs sync + full verification (vault rule)

**Files:**
- Modify: `Capstone/04 - Architecture/Authentication.md` (append dated section)
- Modify: `SYSTEM.md` (append dated bullets)
- Test: full gates.

- [ ] **Step 1: Document in the vault**

Append to `Capstone/04 - Architecture/Authentication.md` a `## Security hardening batch 1 — CONFIRMED (2026-09-16)` section stating: lockout 10/15min on both channels with clear-on-success and `ACCOUNT_LOCKED` semantics; edge throttle 600/min/IP fail-open in proxy with per-instance caveat; `security_alert` rows + read API + the two current types; `createUserSchema` parity; dead-guard deletion. Append matching one-line bullets to `SYSTEM.md`.

- [ ] **Step 2: Run every gate**

```bash
git diff --check
npx eslint src/mobile 2>/dev/null; npx eslint src
npm run verify:auth
npm run test:run
```

Expected: all green. If `test:run` shows failures unrelated to this batch, record them verbatim in the commit message instead of fixing (no drive-by repairs).

- [ ] **Step 3: Commit**

```bash
git add "Capstone/04 - Architecture/Authentication.md" SYSTEM.md
git commit -m "docs(auth): record security hardening batch 1" -m "Lockout, edge throttle, security alerts, schema parity, dead-guard removal, with verification results."
```

---

## Self-Review

1. **Spec coverage:** weak-lock parity → Task 1. Lockout → Tasks 2-4 (helper, web, mobile). Hallway speed limit → Task 5. Alarms → Task 6 (writer, replay trigger, read API). Dead master key → Task 7. Docs → Task 8. MFA-mandatory was P-listed in analysis but NOT requested in this batch — correctly excluded; note it as the recommended next batch in the handoff, not here.
2. **Placeholder scan:** no TBD/TODO; every code step ships exact code. Two honest read-anchors exist (success-path inserts in Tasks 3-5) with the exact call code given and the anchor statement quoted — acceptable per codebase convention since placement depends on surrounding lines the implementer must read anyway. The Task 5 ternary transcription artifact is explicitly flagged for the reviewer.
3. **Type consistency:** `lockoutKey`/`checkAccountLockout`/`recordFailedAttempt`/`clearAccountLockout` signatures identical across Tasks 2-4; `raiseSecurityAlert(req, { type, employeeId, details })` identical across Tasks 3, 4, 6; `checkEdgeThrottle(ip, nowMs)` identical in Task 5 test/impl/wiring; `SECURITY_ALERT_TYPES` gate matches the route's `type` projection. `zod` v4 style (`refine`, no `.superRefine` needed) matches `schemas.js` conventions.
