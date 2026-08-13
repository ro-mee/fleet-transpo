---
type: memory
title: Mistakes I Made
tags: [memory, mistakes]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Mistakes I Made

> Written from **repository evidence**, not from memory of your intent. Where the evidence shows a pattern but not a cause, it's labelled INFERRED. Correct or delete anything that's wrong — this note is more useful accurate than complete.

## Visible in the code — CONFIRMED

### Writing a test that asserts a stub's behaviour
`grounding.test.js` contained `it("grounds Minor/Moderate non-breakdown incidents as well", …)` against a function that ignored its own parameters. The test passed and defended the bug — the suite was green 185/185 while a sev-1 bug was live.
**Lesson:** write the assertion from the requirement, not from the code in front of you. → [[Tests Can Encode Bugs]] *(fixed 2026-08-11)*

### Leaving a complete alternative implementation in the tree
Root `proxy.js` was 1989 B of working `@supabase/ssr` cookie auth that never ran, alongside the 594 B `src/proxy.js` that does. It didn't look like dead code — it looked like the answer.
**Lesson:** delete the old approach when you switch. Git remembers it. *(deleted 2026-08-11)* → [[BUG Root proxy.js Is Dead Code]]

### Applying a schema change outside the migration files
`chk_dispatch_status` permits five values on the live DB; migration 012 declares four. A fresh database built from this repo would be different from the running one.
**Lesson:** if it isn't in a migration, it doesn't exist. → [[DEBT Schema Drift From Migrations]]

### Declaring a dependency without installing it
`vitest: ^3.2.7` in `package.json`, not in `node_modules`. `npm run test:run` has presumably not run in a long time.
**Lesson:** a test command that isn't run in CI stops working and nobody finds out. → [[DEBT Vitest Not Installed]]

### Labelling a document "authoritative"
`docs/rbac-model.md` says so and claims 9 roles; there are 6.
**Lesson:** date documents and cite sources. The label doesn't maintain the file. → [[Documentation Rot]]

## Patterns worth noticing — INFERRED

### Renaming without finishing the rename
`transportation_requests` replaced `vehiclereservations` in migration 016, but the old table, the old sync branch keyed on `reservation_id`, and four stale ERDs remained for twenty-two migrations.
**Lesson:** a rename isn't done until the old thing is deleted. → [[DEBT vehiclereservations vs transportation_requests]] *(finished 2026-08-11 — the removal took 2 columns, 2 FKs, 2 indexes, 2 trigger functions, 5 call sites in 3 modules and a route tree)*

### Duplicate migration numbers
011, 013, 014, 017, 018, 030 each appear twice; **019 three times**; 008 is missing.
**Lesson:** ordering that depends on filenames needs a ledger. → [[ADR-008 Manual Migration Procedure]]
The ledger exists as of 2026-08-11 and is keyed on **filename**, precisely
because the numbers are unreliable. That makes replay deterministic — it does
not make the numbering correct, and renumbering is still open.

### Building breadth before depth
10 tables have zero rows; `trips` and `dispatchschedules` have 2 each. Many features exist end-to-end in code and have barely run.
**Lesson, INFERRED:** seed realistic data earlier — it's the only thing that finds the bugs reading doesn't. → [[Roadmap]]

The count went 11 → 10 for the wrong-sounding reason: `vehiclereservations` left
the list by being **dropped**, not by being exercised. Phase 4 item 14 is still
the fix for the other ten.

## From this session

### Recording an UNKNOWN that was answerable
I filed *"Should a Minor incident ground a vehicle?"* as an open design question — then found the rule documented in **three places** (`grounding.js:3-6`, `incidents/route.js:114-115`, and a `SYSTEM.md` passage, since rewritten). An answerable question filed as UNKNOWN licenses guessing; it's worse than no note.
**Lesson:** before writing "the repository does not document why", grep the whole tree and read the module docstring. An UNKNOWN must survive three attempts to answer it. → [[Open Questions]] *(removed 2026-08-11)*

### Calling a live feature dead because the state machine ignored it
`'Pending Reassignment'` was recorded as "a status nothing sets … a dead end". One `grep` across `src/` found **six files** — its own board lane, a stat card, an auto-exit back to `Scheduled`. Absence from one module is not evidence of absence from the product.
**Lesson:** absence from the state machine is not absence from the codebase. Grep the literal string across the whole tree before declaring anything dead. → [[BUG Pending Reassignment Not In State Machine]] *(reframed 2026-08-11)*

### Trusting a plausible conclusion before querying
`'Pending Reassignment'` was first read as a pure application bug. `pg_constraint` showed the live DB permits it — schema drift *plus* a state-machine gap.
**Lesson:** check the live database before calling something a code bug. → [[Debugging Techniques]]

### Predicting the suite would fail
The pre-run note here said "expect failures — the suite has never been run against the current code." It ran **green 185/185**. The failure wasn't red tests; it was a test asserting the bug. Predicting a different failure mode than the one that exists teaches you the wrong thing.
**Lesson:** read the output, don't pre-judge it. → [[DEBT Vitest Not Installed]]

## From Phase 3 (2026-08-11)

### Citing a file that has never existed
Six vault notes cited `src/lib/scheduling/sync.js` as the home of the reservation
sync helpers, one of them in its `source:` frontmatter. **No such file exists in
the repo or anywhere in its history** — confirmed against `find` and
`git log --all`. The code was in `src/services/status.service.js`. The path was
plausible, consistent across notes, and entirely invented; being repeated six
times made it look verified.
**Lesson:** a citation is a claim. Open the file, or don't cite it — and when a
path appears in several notes, that is one unchecked claim copied, not
corroboration. → [[Things I Should Not Forget]]

### Labelling a comparison table CONFIRMED without re-reading the file
[[DEBT Ingest Paths Diverge]] carried a six-row table marked CONFIRMED. Two rows
were false — it claimed the pull route had no auth and no idempotency check, when
`requireAuth` was on line 18 and the dedupe `SELECT` was in the loop, **in the
file the note listed as its own source**. It also missed three real divergences.
The true bug was worse than the one described.
**Lesson:** CONFIRMED means "I read this file today", not "I believed this
firmly". A wrong detail inside a confident table is harder to catch later than an
honest UNKNOWN.

### Estimating a cleanup from the object, not the references
`vehiclereservations` was described as "as cheap as a schema cleanup ever gets" —
one empty table. Dropping it actually touched two columns, two FKs, two indexes,
two trigger functions, five call sites across three modules, and a six-route API
tree. And **tests plus lint both passed** while five imports of the deleted
function were still live, because vitest only loads what its tests touch and the
eslint config doesn't resolve imports.
**Lesson:** size a deletion by grepping its references, not by looking at the
thing itself. Then grep again after, because the gates here don't catch a broken
import. → [[Things I Should Not Forget]]

### Trusting the roadmap's own count
The roadmap said two stale ERDs. There were four — nobody had listed the
directory since writing the item.
**Lesson:** a count written in a plan is as stale as anything else in the repo.
`ls` before believing it.

## Related

[[Things I Learned]] · [[Bugs]] · [[Technical Debt]] · [[Debugging Techniques]] · [[Journal Index]]
