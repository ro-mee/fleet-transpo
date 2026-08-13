---
type: debt
status: resolved
severity: sev-1
resolved_on: 2026-08-11
tags: [debt, testing, tooling, resolved]
source:
  - package.json
  - vitest.config.mjs
last_verified: 2026-08-11
---

# Debt: Vitest Not Installed

> **STATUS: RESOLVED 2026-08-11.** Installed and running. What the run revealed is the interesting part.

## Symptom — CONFIRMED

```bash
$ npx vitest run
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest'
```

`npx` then offered to install **4.1.10**, while `package.json` pins **`^3.2.7`** — accepting that prompt would have silently upgraded a major version. Both `npm run test` and `npm run test:run` failed.

## The fix — CONFIRMED

```bash
npm i -D vitest@^3.2.7   # pinned deliberately; bare `npx vitest` pulls 4.x
npm run test:run
```

`vitest.config.mjs` **already existed** and was correct — `environment: "node"`, `include: ["src/**/*.test.js"]`, and the `@` → `./src` alias. No config work was needed. (I had assumed it would be missing; it was not. Worth checking before writing one.)

## What the run revealed — CONFIRMED

```
Test Files  15 passed (15)
     Tests  185 passed (185)
```

**Everything passed.** My prior note here predicted "expect failures — the suite has never been run against the current code." That prediction was wrong, and being wrong is the finding:

> The suite was green **while [[BUG shouldGroundVehicle Is A Stub]] was live**, because `grounding.test.js` asserted the buggy behaviour was correct.

So the debt was never really "the runner doesn't work." It was that **nobody could see the suite was lying**. Installing the runner turned an unverifiable claim into a verifiable — and false — one. After fixing the bug and inverting the test: **186 tests, 15 files, all passing.**

## What the suite does not cover — CONFIRMED

All 15 files test **pure functions** in `src/lib/` and one service. There are **no route-level tests**. That is why a green suite did not catch [[BUG AuthError Not Imported]] — nothing exercises `src/app/api/**`. Coverage is real but narrow; treat "the tests pass" as a statement about `src/lib/`, not about the app.

## Why it happened — INFERRED

`devDependencies` listed vitest but `node_modules` did not contain it — most likely an `npm install --omit=dev` or a partial install. The repository does not currently document why.

## How to prevent it

- Run the test suite in CI so a missing dev dependency fails loudly.
- Treat "the tests pass" as a claim requiring evidence — paste the output.
- Pin the version when installing; `npx <tool>` resolves to latest, not to your declared range.

## Related

[[Technical Debt]] · [[Testing]] · [[Current State]] · [[Debugging Index]] · [[Quick Reference]] · [[Tests Can Encode Bugs]]
