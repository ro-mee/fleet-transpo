---
type: journal
date: 2026-08-11
tags: [milestone, journal]
source:
  - Capstone/
last_verified: 2026-08-11
---

# Milestone: Vault Established — 2026-08-11

## What happened

The repository was read end to end and the live database queried read-only. This vault is the result: not a copy of the code, but a record of **what the code turned out to actually be**.

## The finding that shaped everything else

**In-code documentation in this repository is excellent. Standalone `.md` files have rotted.**

Every well-reasoned decision — `withTransaction`'s docstring, migration 023's header, `dispatch-advisor.js:11-14`, the RLS warning, the single-flight comment in `mobile/lib/api.js` — is written **next to the code that implements it**, and every one is accurate.

Every standalone document is wrong in some way: `docs/rbac-model.md` calls itself authoritative and claims 9 roles (there are 6), `SYSTEM.md` references a file Next 16 renamed, both ERDs omit the main table, `README.md` is untouched boilerplate.

The mechanism isn't discipline — it's **proximity**. A comment beside an implementation shows up in the diff when that implementation changes. → [[Documentation Rot]]

That's why every note here carries `source:` and `last_verified:`, and why this vault holds only what *can't* live in a docstring: cross-file reasoning, decision history, and navigation.

## Established by this session

| Count | What |
|---|---|
| 6 | MOCs |
| 5 | templates |
| 10 | ADRs |
| 20 | learning concepts |
| 15 | problem notes |
| 11 | table notes |
| 13 | feature notes |
| 4 | state-machine / lifecycle notes |

Every claim is labelled CONFIRMED, INFERRED, or UNKNOWN. Nothing was invented.

## The four confirmed bugs

Found by reading, not by running — there are no runnable tests. → [[Bugs]]

1. [[BUG shouldGroundVehicle Is A Stub]] — grounds every vehicle, and **its test asserts the bug is correct**
2. [[BUG AuthError Not Imported]] — 404 becomes 500 on a driver-facing route
3. [[BUG Root proxy.js Is Dead Code]] — a complete, plausible auth implementation that never runs
4. [[BUG Pending Reassignment Not In State Machine]] — live DB and code disagree about legal states

**Three of the four live on paths normal use never touches.** None would announce itself.

## The correction worth remembering

`'Pending Reassignment'` was initially read as a pure code bug. Querying `pg_constraint` on the live database showed the constraint **does** permit it — five values, while migration 012 declares four. It's schema drift *plus* a state-machine gap, not a code bug.

**The rule that came out of it: check `pg_constraint`, not the migration file.** A migration records an intention that was true when written. → [[Debugging Techniques]]

## Next

Phase 1 of the [[Roadmap]]: install vitest, read what the existing tests actually assert, then fix `grounding.js` **and its test** together.

## Related

[[Journal Index]] · [[Current State]] · [[Home]] · [[Things I Learned]] · [[Decision Log]]
