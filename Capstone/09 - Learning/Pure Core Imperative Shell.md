---
type: learning
tags: [learning, architecture, design, testing]
source:
  - src/lib/
  - src/services/
last_verified: 2026-08-11
---

# Concept: Pure Core Imperative Shell

## What it is

Split code in two:

- **Pure core** — decisions. No I/O. Same inputs → same outputs, always. Trivially testable: call it, assert the return.
- **Imperative shell** — effects. Reads the DB, calls the core, writes the result. Hard to test, so keep it thin and dumb.

Rule of thumb: *the shell should contain no interesting decisions, and the core should contain no I/O.*

## Why it matters

Testability follows the split. Testing a function that queries a database needs a database, or mocks that drift from reality. Testing `canTransition("APPROVED","DISPATCHED")` needs nothing.

It also makes rules **readable**. Business logic buried between `await` calls is invisible; in a pure module it's the whole file.

## How it appears in my project — CONFIRMED

| Layer | Location | Contains |
|---|---|---|
| Pure core | `src/lib/<domain>/` | state machines, scoring, UVVRP eval, grounding, contracts |
| Shell | `src/services/`, route handlers | queries, transactions, orchestration |

The clearest example is `src/lib/ai/dispatch-advisor.js` — scoring is arithmetic over a passed-in candidate array. It never queries. The route fetches candidates, calls the scorer, returns the result. → [[AI Advisory]]

Same for `src/lib/scheduling/trip-state.js`: a `RANK` map and comparisons. No `await` in the file. → [[Trip State Machine]]

## Where the pattern is broken — CONFIRMED

`src/services/` holds **both** server-only DB modules and client-side fetch wrappers under one folder name. The split is real but the naming hides it, and the hazard is importing a server module into a client component. → [[DEBT Services Folder Mixes Two Concerns]]

The other break: `src/lib/notifications/` is *conceptually* pure, but the effects it would perform live in **database triggers** instead — an imperative shell that isn't in the application at all. → [[ADR-005 Notifications In Database Triggers]]

## How to tell which side a file is on

Search it for `await`, `query(`, `fetch(`, `getAdminClient`. Zero hits → core. Many hits and few `if`s → shell. **Many of both → the file to split.**

## Common mistakes

| Mistake | Fix |
|---|---|
| A pure function that "just needs one lookup" | Pass the looked-up value in as a parameter |
| Mocking the DB to test a rule | The rule shouldn't have needed the DB |
| Decisions in the route handler | Move them to `lib/`; the handler calls one function |
| Naming by layer, not by side | See the `services/` collision above |

## Related concepts

[[Architecture]] · [[State Machines]] · [[Testing]] · [[Anti-Corruption Layer]] · [[Deterministic Core With Nullable Narration]] · [[Learning Dashboard]]
