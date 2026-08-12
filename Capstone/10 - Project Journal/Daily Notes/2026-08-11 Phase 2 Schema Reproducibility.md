---
type: journal
date: 2026-08-11
tags: [journal, daily]
source:
  - eslint.config.mjs
  - scripts/migrate.mjs
  - scripts/dump-schema.mjs
  - scripts/load-env.mjs
  - schema.sql
  - supabase/migrations/033_dispatch_status_pending_reassignment.sql
  - supabase/migrations/034_backfill_undeclared_tables.sql
  - supabase/migrations/035_driverincidents_assistance_needed.sql
last_verified: 2026-08-11
---

# 2026-08-11 — Phase 2: Schema Reproducibility

Same day as [[2026-08-11 Phase 1 Roadmap]], continued. Two commits:
`6296b98` (correctness) and `cbca742` (schema).

## What I worked on

- **Enabled `no-undef` for plain `.js`** in `eslint.config.mjs`, with
  browser/node/serviceworker globals plus Expo's `__DEV__`. Within minutes it
  found a **4th** instance of the bug class from Phase 1: `setRequestFlags` used
  but never imported in `reservations/queue/page.js`. → [[BUG AuthError Not Imported]]
- **Excluded `mobile/dist/**` from lint** — gitignored Expo build output that was
  producing **772 of 773** errors. Lint went 60 → 38 errors, and the 22
  `react/display-name` errors "fixed" by this were never in my code at all.
- **`scripts/dump-schema.mjs` → checked-in `schema.sql`.** 39 tables, 1 view,
  88 FKs, 95 indexes, 13 functions, 19 triggers. Emits **no timestamp**, so any
  diff is a real schema change.
- **Migrations 033–035** — the dispatch status value, four undeclared tables, one
  undeclared column. All written as no-ops against live. → [[DEBT Schema Drift From Migrations]]
- **Removed the runtime `CREATE TABLE` calls** from `src/lib/ai/logger.js` and
  both `api/ai/*` routes. → [[DEBT Runtime DDL On Hot Path]]
- **`scripts/migrate.mjs` + a `schema_migrations` ledger**, and deleted nine
  one-off root scripts. → [[ADR-008 Manual Migration Procedure]]

## What I learned

- **A monotonic rank cannot express a cycle.** The plan for
  `'Pending Reassignment'` was "add it to `RANK`". That is the wrong shape: entry
  is from `Scheduled` **or** `In Progress`, and exit returns to `Scheduled`. It
  needed an explicit off-ladder `INTERRUPT` set. The planned fix would have
  compiled and been wrong. → [[BUG Pending Reassignment Not In State Machine]]
- **Verification tooling can be dead.** Every verification script in this repo
  had been loading **zero** credentials — `load-env.mjs` defaulted to a
  nonexistent `.env.local`, then choked on a BOM and CRLF, and reported success
  at each step because "file absent" and "line didn't parse" both meant *carry
  on*. → [[Verification Tooling Can Be Dead]]
- **`git rm` does not remove a secret.** One deleted script had the live DB
  password hardcoded, and deleting it left the value in history. **Rotated later
  the same day** — that, not the deletion, is what closed the exposure.
  → [[SEC Database Password In Git History]]
- **Filenames, not version numbers**, are the only unique key available for the
  ledger: 011/013/014/017/018/030 appear twice, 019 three times, 008 not at all.

## Problems encountered

- **`package.json` carried both commits' changes** — commit 1 would have shipped
  a `db:*` script referencing a `migrate.mjs` that did not exist yet. Split it by
  hand before committing.
- **Nearly deleted root `proxy.js` unverified.** Stopped and confirmed against
  the Next 16 docs and git that the root copy was dead and `src/proxy.js` is the
  live one — they are genuinely different files with different auth models.
- **I got the counts wrong four times** while writing this vault up: claimed
  nothing new was created (`schema_migrations` is new), then 40 tables (39), then
  41 migrations (42), then 18 verification scripts (17). Every one was fixed by
  running a command instead of reasoning about it. → [[Mistakes I Made]]
- **I fabricated an explanation** for where this vault's old "37 tables / 86 FKs"
  came from. There is no record. It now says so.

## Decisions made

- **Declare, don't drop.** `substitute_vehicle_schedules` has **1 live row**, so
  migration 034 declares it. Dropping destroys data — a product call, not cleanup.
- **Do not renumber the migrations.** The ledger makes duplicates survivable;
  renumbering would rewrite applied history for cosmetic gain.
- Ledger keys on filename, stores a checksum, and **refuses to run if an applied
  file was edited**.

## Next steps

1. ~~**Rotate the database password.**~~ → **done the same day.** Verified both
   directions: the new credential connects and runs the full toolchain, and the
   leaked one now fails authentication. → [[SEC Database Password In Git History]]
2. Fix the 38 pre-existing UI lint errors; the largest group is 15
   `set-state-in-effect`, which is the one that can cause real render loops.
3. `SYSTEM.md:457-459, 587` still describe the grounding bug as live behaviour —
   carried over unaddressed from Phase 1. → [[Documentation Rot]]
4. Phase 3: drop `vehiclereservations`, unify the ingest paths, rewrite `README.md`.

## Related

[[2026-08-11 Phase 1 Roadmap]] · [[Roadmap]] · [[Current State]] · [[Migrations]] · [[Bugs]]
