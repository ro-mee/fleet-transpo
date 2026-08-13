---
type: learning
tags: [learning, testing, quality]
source:
  - package.json
  - vitest.config.mjs
  - src/lib/driver/grounding.test.js
  - eslint.config.mjs
last_verified: 2026-08-11
---

# Concept: Testing

## Current state — CONFIRMED (run 2026-08-11)

| Fact | Detail |
|---|---|
| Test runner | `vitest 3.2.7`, **installed and working** |
| Config | `vitest.config.mjs` — `environment: "node"`, `include: ["src/**/*.test.js"]`, `@` → `./src` alias |
| Layout | **colocated** — `src/lib/driver/grounding.test.js`, *not* a `__tests__/` directory |
| Result | **16 files, 197 tests, all passing** |
| CI | none |

An earlier version of this note said the suite had "an unknown pass rate" and predicted failures. Both wrong — see below, because *why* they were wrong is the actual lesson.

## The second thing a green run does not prove — CONFIRMED (2026-08-11)

**It is not a link check.** In Phase 3, `npm run test:run` *and* eslint both passed
while a deleted function (`syncDispatchReservation`) was still imported in three
modules with five call sites. Vitest only loads the modules its tests reach, and
the flat eslint config doesn't run `import/no-unresolved`. Nothing in this repo
resolves an import graph. After deleting or moving any exported symbol, grep the
tree for its name. → [[Things I Should Not Forget]]

## The lesson the run itself taught — CONFIRMED

The suite was **green while a sev-1 bug was live**. `grounding.test.js` contained `it("grounds Minor/Moderate non-breakdown incidents as well")` — an assertion that the bug was correct behaviour. 185 passing tests, one of which was actively defending the defect.

> **A green suite is evidence that the code matches the tests. It is not evidence that the code matches the requirement.**

→ [[Tests Can Encode Bugs]]

Second lesson from the same run: installing the runner did **not** catch [[BUG AuthError Not Imported]], because 15 of the 16 files test pure functions in `src/lib/` and the sixteenth tests one service (`maintenance-schedule.service.test.js`). **There are no route-level tests.** Coverage is real but narrow — "the tests pass" is a statement about `src/lib/`, not about the app.

The closest thing to a route test arrived in Phase 3: `src/lib/integration/ingest.test.js` asserts that both ingest doors emit an **identical SQL string and identical params array**. It tests the shared writer, not the routes — but it pins the exact property that had been broken. → [[DEBT Ingest Paths Diverge]]

Third: the thing that *did* catch that bug class was **lint**, not tests — and only in JSX, because `react/jsx-no-undef` is enabled while plain `no-undef` is not. Two live instances (`Badge`, `Search` in `assign-dialog.jsx`) surfaced instantly. Different tools catch different classes; neither substitutes for the other. → [[Defence In Depth]]

## What this codebase is unusually easy to test

The pure/impure split is genuinely good, and it hands you high-value tests for almost no setup cost — no database, no mocks, no fixtures. → [[Pure Core Imperative Shell]]

| Target | Test | Status |
|---|---|---|
| `trip-state.js` | rank never decreases; `COMPLETED` is terminal | not yet written → [[Trip State Machine]] |
| reservation adjacency | every `transitionPath` result is a legal walk | not yet written — BFS is easy to get subtly wrong |
| `dispatch-state.js` | DB `chk_dispatch_status` values == `isValidDispatchStatus` | ✅ **written — 9 tests**; the drift it would have caught was fixed by migration 033 → [[BUG Pending Reassignment Not In State Machine]] |
| UVVRP | each weekday × each plate ending | ✅ covered — 17 tests |
| `dispatch-advisor.js` | same input → same scores | partially — see `pair-scoring.test.js` → [[ADR-003 Deterministic AI]] |
| `contracts.js` | unknown priority → `Medium`, no throw | not yet written → [[Anti-Corruption Layer]] |
| `shouldGroundVehicle` | Minor **does not** ground | ✅ **fixed and covered — 8 tests** |

## What needs real infrastructure

| Target | Needs | Note |
|---|---|---|
| `trg_dispatch_overlap` under load | **two concurrent connections** | the guard has never been raced → [[TOCTOU And Advisory Locks]] |
| `withTransaction` rollback | a real DB | mocks can't reproduce partial-unique-index rejection |
| Route auth coverage | a static scan, not a test | enumerate `route.js`, assert each calls a guard |

That middle-of-the-pyramid work is where the cost is. Do the cheap pure ones first.

## Three rules earned from this repository

### 1. Assert the rule, not the code
`grounding.test.js` asserted what the stub did. It passed. The code was wrong. Write assertions from the requirement, before or independent of the implementation. → [[Tests Can Encode Bugs]]

### 2. Test the failure paths
The bugs found here lived on paths normal use never touches — a 404 branch, a dead file, a validator gap. **Happy-path tests would have caught none of them.** → [[Bugs]]

### 3. Test the seams between code and database
The most consequential divergences found — `chk_dispatch_status` vs the state machine, and the ERDs vs the real schema — are both *code and DB disagreeing*. Nothing in a unit suite looks there. One test that reads `information_schema` and compares it to the constants in `src/lib/` would have caught both. → [[DEBT Schema Drift From Migrations]]

## The order to do this in

1. ~~`npm i -D vitest@^3.2.7`~~ ✅ done — pinned, because bare `npx vitest` resolves to 4.x
2. ~~Fix `grounding.js` **and** its test together~~ ✅ done
3. Add the remaining pure tests above
4. Add the schema-vs-constants check
5. Enable `no-undef` for `.js`
6. One CI job: lint + tests + schema check → [[Roadmap]]

## Common mistakes

| Mistake | Better |
|---|---|
| Chasing coverage % | Cover the rules that would cost money to get wrong |
| Mocking the DB for a pure rule | The rule shouldn't touch the DB |
| Only happy paths | The error branch is what breaks in production |
| **Trusting green** | Ask what each test catches if deleted — this repo proves the point → [[Defence In Depth]] |
| Tests that can't run in CI | An untriggered test is documentation |

## Related concepts

[[Tests Can Encode Bugs]] · [[Pure Core Imperative Shell]] · [[State Machines]] · [[DEBT Vitest Not Installed]] · [[Technical Debt]] · [[Learning Dashboard]] · [[Defence In Depth]]
