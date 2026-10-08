# Dev-Only OTP Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let manual web testers log in with password only via a dev-only env flag, with zero production effect.

**Architecture:** Pure helper `isDevOtpBypassEnabled()` (dependency-free, testable without DB) + one branch in `authorize()` in `src/lib/auth.js` at the top of the OTP block. Timeout needs no code — set `idleTimeoutSeconds=3600` via the existing Settings card.

**Tech Stack:** NextAuth credentials `authorize()`, Vitest, ESLint (`npm run lint:ci` with `--max-warnings 0`).

## Global Constraints

- Bypass fires only when `DEV_BYPASS_OTP === "1"` AND `NODE_ENV !== "production"` — exact values, no other truthy string enables it.
- Mobile login route (`src/app/api/mobile/auth/login/route.js`) is untouched — web-only scope.
- No migration, no `schema.sql` diff, no `db:contract` / `verify:anon` change.
- Audit action name is `mfa_bypassed_dev`, resource `authentication`, channel `web`.
- `npm run lint:ci` must stay clean (`--max-warnings 0`).

---

### Task 1: Pure dev-bypass helper + unit tests

**Files:**
- Create: `src/lib/auth/dev-bypass.js`
- Create: `src/lib/auth/dev-bypass.test.js`

**Interfaces:**
- Consumes: `process.env.DEV_BYPASS_OTP`, `process.env.NODE_ENV` (via optional `env` param for tests)
- Produces: `isDevOtpBypassEnabled(env?) -> boolean` imported by `src/lib/auth.js` in Task 2

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
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
    expect(isDevOtpBypassEnabled({ DEV_BYPASS_OTP: "1", NODE_ENV: "production" })).toBe(true === false);
  });
});
```

Note: the last assertion is intentionally written as `toBe(true === false)` so the first run fails on exactly the production-guard behavior. It will be corrected to `toBe(false)` in Step 3 after seeing it fail.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/dev-bypass.test.js`
Expected: FAIL with "Cannot find module './dev-bypass'"

- [ ] **Step 3: Write minimal implementation**

```js
/**
 * Dev-only OTP bypass switch for manual web testing.
 *
 * Dependency-free on purpose (same reason as session-policy.js / otp-policy.js):
 * it must be importable without pulling in `@/lib/db`.
 *
 * Fires only when DEV_BYPASS_OTP === "1" AND NODE_ENV !== "production".
 * Production ignores the flag unconditionally (fail closed).
 *
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env; injectable for tests
 * @returns {boolean}
 */
export function isDevOtpBypassEnabled(env = process.env) {
  return env?.DEV_BYPASS_OTP === "1" && env?.NODE_ENV !== "production";
}
```

Then fix the Step 1 placeholder: change `toBe(true === false)` to `toBe(false)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/dev-bypass.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/dev-bypass.js src/lib/auth/dev-bypass.test.js
git commit -m "feat(auth): add dev-only OTP bypass helper"
```

### Task 2: Wire bypass into web authorize() + env docs

**Files:**
- Modify: `src/lib/auth.js:1-27` (import), `src/lib/auth.js:152` (OTP block head)
- Modify: `.env.local.example:37-45` (append documented flag)

**Interfaces:**
- Consumes: `isDevOtpBypassEnabled()` from Task 1
- Produces: password-only login in dev when flag set; unchanged OTP path otherwise

- [ ] **Step 1: Write the failing test**

No new test file — extend `src/lib/auth/dev-bypass.test.js` with a contract pin that `src/lib/auth.js` imports the helper (structural guard, mirrors the `resolveCurrentIdentity` read-only guard pattern):

```js
import { readFileSync } from "node:fs";

it("auth.js gates the bypass behind isDevOtpBypassEnabled", () => {
  const src = readFileSync("src/lib/auth.js", "utf8");
  expect(src).toContain("isDevOtpBypassEnabled");
  expect(src).toContain('mfa_bypassed_dev');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/dev-bypass.test.js`
Expected: FAIL with "expected ... to contain 'isDevOtpBypassEnabled'"

- [ ] **Step 3: Write minimal implementation**

In `src/lib/auth.js`, add to the import block:

```js
import { isDevOtpBypassEnabled } from "@/lib/auth/dev-bypass";
```

At the head of the `if (!trustedDevice) {` block (line 152), before the `isEmailConfigured()` fail-closed check, insert:

```js
        // Dev-only testing bypass. Inert in production by construction:
        // isDevOtpBypassEnabled() is false when NODE_ENV === "production"
        // even if the flag is set, so the OTP path below still runs there.
        if (isDevOtpBypassEnabled()) {
          if (process.env.NODE_ENV === "production") {
            console.warn(JSON.stringify({ event: "dev_bypass_ignored_in_production", channel: "web" }));
          } else {
            await writeAudit(auditReq, null, {
              action: "mfa_bypassed_dev",
              resource: "authentication",
              resourceId: employee.employee_id,
              newValues: { channel: "web" },
            });
          }
        }
        if (!isDevOtpBypassEnabled() && (!isEmailConfigured() || !isDeliverableEmailAddress(employee.email))) {
```

Wait — that double-call is clumsy and the prod-warn branch is dead code (helper is already false in prod). Simplify before saving. The actual edit to save:

```js
        if (isDevOtpBypassEnabled()) {
          await writeAudit(auditReq, null, {
            action: "mfa_bypassed_dev",
            resource: "authentication",
            resourceId: employee.employee_id,
            newValues: { channel: "web" },
          });
        } else if (!isEmailConfigured() || !isDeliverableEmailAddress(employee.email)) {
```

And convert the existing bare `if (!isEmailConfigured() ...)` into that `else if`, keeping its body byte-identical. Then wrap the remainder of the OTP block (from `const sendNewCode` through the end of `if (!factor.ok) {...}` at ~line 298) inside `if (!isDevOtpBypassEnabled()) { ... }` — or equivalently, early-continue: since the block ends right before `let driverStatus = null;` (~line 300), the cleanest minimal diff is to change `if (!trustedDevice) {` to `if (!trustedDevice && !isDevOtpBypassEnabled()) {` and add the audit write just before it:

```js
        // Dev-only testing bypass (never fires in production — see dev-bypass.js).
        // Test logins stay visible via the mfa_bypassed_dev audit row.
        if (!trustedDevice && isDevOtpBypassEnabled()) {
          await writeAudit(auditReq, null, {
            action: "mfa_bypassed_dev",
            resource: "authentication",
            resourceId: employee.employee_id,
            newValues: { channel: "web" },
          });
        }

        if (!trustedDevice && !isDevOtpBypassEnabled()) {
```

This keeps the entire existing OTP body untouched inside the second `if` — one condition changed, one audit block added, zero logic re-indentation.

Append to `.env.local.example`:

```
# Dev-only OTP bypass for manual web testing (NEVER set in production).
# Password-only login when "1" and NODE_ENV != "production". Ignored in prod.
# DEV_BYPASS_OTP=0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth/dev-bypass.test.js src/lib/auth.test.js`
Expected: PASS

Run: `npm run lint:ci -- src/lib/auth/dev-bypass.js src/lib/auth/dev-bypass.test.js src/lib/auth.js`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.js src/lib/auth/dev-bypass.test.js .env.local.example
git commit -m "feat(auth): wire dev-only OTP bypass into web authorize"
```

### Task 3: Manual verification + docs sync

**Files:**
- Modify: `Capstone/04 - Architecture/Authentication.md` (one paragraph under email OTP section)
- Modify: `Capstone/01 - System/System Overview.md` (one bullet in the dated change list)
- Test: manual dev-server check (no new test file)

**Interfaces:**
- Consumes: Task 1 + Task 2
- Produces: verified behavior + vault in sync per `.agents/AGENTS.md`

- [ ] **Step 1: Manual verify bypass ON**

Run: `DEV_BYPASS_OTP=1 npm run dev`
Expected: web login with email + password succeeds without OTP email; `audit_logs` has an `mfa_bypassed_dev` row for the employee.

- [ ] **Step 2: Manual verify bypass OFF + timeout config**

Run: unset flag, restart dev; set Settings → Security & Sessions → Idle timeout to 60 min; re-login.
Expected: OTP email demanded again; session survives >5 min idle.

- [ ] **Step 3: Update vault notes**

In `Capstone/04 - Architecture/Authentication.md`, under the email-OTP section, append one paragraph: dev-only `DEV_BYPASS_OTP=1` skips web OTP when non-production, writes `mfa_bypassed_dev`, mobile untouched, production ignores it. In `Capstone/01 - System/System Overview.md`, add a dated bullet (2026-10-08) with the same two sentences. Update `System.md` per vault rule if it indexes auth changes.

- [ ] **Step 4: Run full gates**

Run: `npx vitest run src/lib/auth/`
Expected: PASS

Run: `npm run lint:ci`
Expected: exit 0 (full-repo gate per repo policy)

- [ ] **Step 5: Commit**

```bash
git add Capstone/ docs/superpowers/specs/2026-10-08-dev-otp-bypass-design.md docs/superpowers/plans/2026-10-08-dev-otp-bypass.md
git commit -m "docs: dev-only OTP bypass verification and vault sync"
```
