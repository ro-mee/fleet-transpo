---
type: moc
title: Debugging Index
tags: [moc, debugging, bugs, debt]
source:
  - src/app/api/trips/[id]/start/route.js
  - src/lib/driver/grounding.js
  - src/lib/scheduling/dispatch-state.js
  - proxy.js
last_verified: 2026-08-11
---

# Debugging Index

Every finding here was **verified against the actual file or the live database**, not inferred from a filename.

## Open bugs

| Note | Severity | One-line |
|---|---|---|
| [[BUG Dispatch Teardown Ungrounds Vehicle]] | ✅ Fixed 2026-08-23 | Each dispatch teardown re-synced availability and reset the freshly-grounded vehicle to `Available`. Found by the headless E2E rehearsal, not by review |
| [[BUG AuthError Not Imported]] | ✅ Fixed | Trip-start 404 path threw `ReferenceError`. Import added; `no-undef` enabled so the class can't recur silently |
| [[BUG shouldGroundVehicle Is A Stub]] | ✅ Fixed | Grounded **every** vehicle on any incident — and tore down its live dispatch |
| [[BUG Pending Reassignment Not In State Machine]] | ✅ Fixed | DB allowed a status the code rejected. Migration 033 + an explicit `INTERRUPT` set |
| [[BUG Root proxy.js Is Dead Code]] | ✅ Fixed | Dead file implied the wrong auth model. Deleted |

**All five are closed as of 2026-08-23.** New bugs go above; the closed ones stay
because *how* each was found is the reusable part.

## Technical debt

| Note | Severity | One-line |
|---|---|---|
| [[DEBT Services Folder Mixes Two Concerns]] | 🟡 Sev 3 | Server services and client fetchers share a folder. Phase 3 hit it: the obvious home for shared ingest code was client-side |

**Closed 2026-08-11:** [[DEBT Vitest Not Installed]] (197 tests run) ·
[[DEBT Schema Drift From Migrations]] (033–035, `schema.sql`, a ledgered runner) ·
[[DEBT Runtime DDL On Hot Path]] (all three `CREATE TABLE` calls gone) ·
[[DEBT vehiclereservations vs transportation_requests]] (migration 036) ·
[[DEBT Ingest Paths Diverge]] (one shared `ingestRequest()`)

## Documentation rot

| Note | One-line |
|---|---|
| [[DOC Mobile Tabs Documented Three Ways]] | Three docs, three wrong answers |

**Closed 2026-08-11:** [[DOC ERDs Missing Core Table]] (`docs/erd/` deleted — four
files, not two) · [[DOC rbac-model Says 9 Roles]] (rewritten; the RBAC harness now
pins it) · [[DOC README Is Boilerplate]] (rewritten) ·
[[DOC SYSTEM.md References middleware.js]] (corrected in place).
Treat that as a snapshot, not a property. → [[Documentation Rot]]

## The pattern behind all of it — INFERRED

**In-code documentation is excellent. Standalone `.md` files had rotted.**

Docstrings in `src/lib/db.js`, `mobile/lib/api.js`, and migration headers like `023_dispatch_overlap_guard.sql` explain *why* with real precision — and were right every time they were checked. `docs/rbac-model.md`, `SYSTEM.md`, `README.md` and four ERDs were confidently wrong until they were rewritten or deleted on 2026-08-11.

**Why:** a docstring lives next to the code it describes, so changing the code puts the doc in your diff. A separate `.md` has no such gravity.

**How to apply:** this is why every note in this vault carries `source:` and `last_verified:`. See [[Documentation Rot]].

## Debugging techniques that worked here

1. **Query the live DB, don't trust the migrations.** Migration files claimed `chk_dispatch_status` had 4 values; the live constraint had 5. Only `information_schema` / `pg_constraint` tells the truth.
2. **Grep for the symbol, not the concept.** `AuthError` looked imported until a targeted grep showed zero import lines. The same grep is mandatory *after* a deletion: in Phase 3 both the test suite and eslint passed with a removed function still imported in three modules. → [[Things I Should Not Forget]]
3. **Read tests as specifications of current behaviour, not correctness.** `grounding.test.js` asserted the bug. See [[Tests Can Encode Bugs]].
4. **Count rows before believing a feature works.** 10 tables have zero rows.
5. **Open a file before citing it.** Six notes cited `src/lib/scheduling/sync.js`; it has never existed. Six repetitions of an unchecked claim look like corroboration. → [[Mistakes I Made]]

## Related

[[Home]] · [[Current State]] · [[Technical Debt]] · [[Bugs]] · [[Learning Dashboard]]
