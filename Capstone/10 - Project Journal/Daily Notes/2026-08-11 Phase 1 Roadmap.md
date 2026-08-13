---
type: journal
date: 2026-08-11
tags: [journal, daily]
source:
  - src/lib/driver/grounding.js
  - src/app/api/trips/[id]/start/route.js
  - src/components/reservations/assign-dialog.jsx
  - proxy.js
last_verified: 2026-08-11
---

# 2026-08-11 — Phase 1 of the Roadmap

## What I worked on

- **Installed vitest** (`npm i -D vitest@^3.2.7`, pinned — bare `npx vitest` resolves to 4.x) and ran the suite for the first time: **186 tests across 15 files, all passing.**
- **Fixed [[BUG shouldGroundVehicle Is A Stub]]** — `src/lib/driver/grounding.js` now implements the rule its own docstring documents (breakdown-type **or** Major/Critical), and rewrote the test that had been *asserting the bug*.
- **Fixed [[BUG AuthError Not Imported]]** in `src/app/api/trips/[id]/start/route.js` — the 404 branch was throwing `ReferenceError` instead.
- **Fixed the same bug class twice more** — `Badge` and `Search` used without imports in `src/components/reservations/assign-dialog.jsx:298,306`. Found by grouping `eslint src mobile` output by rule: 95 problems → two `react/jsx-no-undef` jumped out.
- **Deleted the dead root `proxy.js`** — confirmed dead by reading `next/dist/build/index.js:617` (`rootDir = join(appDir, '..')` → only `src/` is scanned), not by assuming.

## What I learned

- **A green suite can encode bugs.** 185/185 passed while a sev-1 bug was live — a test asserted the stub's behaviour was correct. Installing the runner didn't reveal a failure; it revealed that the tests were defending the defect. → [[Tests Can Encode Bugs]]
- **`no-undef` is off for `.js`** — that's *why* the `AuthError` bug shipped. The JSX variant is on, which is how `Badge`/`Search` were catchable at all.
- **Grep before declaring anything dead or undocumented.** The grounding rule was documented in three places; `'Pending Reassignment'` exists in six files. Both were recorded as UNKNOWN in this vault. → [[Mistakes I Made]]
- **`vitest.config.mjs` already existed** — I assumed it was missing. Check before creating.

## Problems encountered

- Lint: 60 errors / 33 warnings remain, all pre-existing, all UI (`react/display-name` 22, `no-img-element` 17, `set-state-in-effect` 15, …). None are correctness bugs of the fixed class.
- The `'Pending Reassignment'` validator gap and the schema drift in `chk_dispatch_status` remain **open** → [[BUG Pending Reassignment Not In State Machine]]

## Decisions made

- Grounding: the documented rule is the rule. No policy question was ever open.
- Delete root `proxy.js` (user-approved) rather than annotating it.
- Test fix committed with the code fix, not separately.

## Next steps

1. Enable `no-undef` for `.js` (carried over from Phase 1)
2. Phase 2: schema reproducibility — backfill the drifted migrations, close the `'Pending Reassignment'` gap
3. Update `SYSTEM.md:457-459, 587` — they describe a bug that no longer exists
