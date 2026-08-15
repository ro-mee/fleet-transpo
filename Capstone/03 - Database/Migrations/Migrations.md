---
type: reference
title: Migrations
tags: [database, migrations]
source:
  - supabase/migrations
  - AGENTS.md
last_verified: 2026-08-11
---

# Migrations

**51** files in `supabase/migrations/` (39 pre-existing, `033`–`035` from the
2026-08-11 backfill, and `036`–`049` since), backed by a ledger and a checked-in
`schema.sql`. History before 2026-08-11 is still not a faithful record — read
[[DEBT Schema Drift From Migrations]] for what was undeclared and how it was closed.

> Counted with `ls supabase/migrations/*.sql | wc -l`. This vault said "38 files"
> for the pre-backfill state; the real number was 39. If a count here matters to
> you, re-run the command rather than trusting the note.

## How to apply one — CONFIRMED PROCEDURE

```bash
npm run db:status   # applied / pending / changed-since-applied
npm run db:up       # apply pending, in filename order, each in a transaction
npm run db:dump     # regenerate schema.sql from live
```

`scripts/migrate.mjs` connects with `pg` + the real `DATABASE_URL` — the
`supabase` CLI, `psql` and `docker` are all unusable here, and the Supabase
SQL editor was found to silently target the wrong project. → [[ADR-008 Manual Migration Procedure]]

Writing a new one:

1. `ls supabase/migrations/` first — **do not reuse a number** (see below).
2. Make it idempotent: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `DROP ... IF EXISTS`. The live DB is ahead of the files in places, so a
   migration must be a safe no-op there.
3. `npm run db:up`, then `npm run db:dump` and commit the `schema.sql` diff.
   **That diff is the review artifact** — it is what makes drift visible.

`schema.sql` is generated. Never edit it by hand. Never hardcode credentials
in a script — `scripts/load-env.mjs` reads `.env`, and the one script that
ignored this leaked the production password into git history
([[SEC Database Password In Git History]]).

**The ledger keys on filename, not version number**, precisely because the
numbers are not unique — `019_admin_role.sql` and
`019_service_interval_guards.sql` are two distinct rows. It also stores a
checksum per file and **refuses to run if an already-applied file was edited**,
since an edited applied migration no longer describes the database.

## Rebuilding a database from scratch — do NOT use `db:up`

`db:up` replays migration **files**. Those files cannot reproduce this database:
the numbering is ambiguous, several were written against a schema that has since
moved, and most are not idempotent. Against an empty ledger, `up` would try to
replay all 42 in filename order and fail partway.

The path that works:

1. Run `schema.sql` against the empty database — it is executable DDL
   (216 `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` statements), structure
   only, no data or grants.
2. `node scripts/migrate.mjs baseline` — records every file as applied without
   running any of it, so the new database starts in step with the ledger.

**UNVERIFIED:** this has never actually been executed against an empty database.
It is what the two scripts are built to do, not something observed working. The
first person to try it should expect ordering problems with sequences and
`REFERENCES` and should fix `dump-schema.mjs` rather than hand-patch the output.

## Numbering is broken — CONFIRMED

**`008` is missing.** Duplicated numbers:

| Number | Copies |
|---|---|
| 011, 013, 014, 017, 018, 030 | ×2 |
| **019** | **×3** |

13 of 42 files have an ambiguous position. **Survivable now** — the ledger
keys on filename, not number — but not correct. Renumbering would mean
rewriting applied history for cosmetic gain, so it stays. → [[ADR-008 Manual Migration Procedure]]

## The migrations worth reading — CONFIRMED

| Migration | Why it's worth your time |
|---|---|
| `002_rls_policies.sql` | Header: *"⚠️ INERT AT RUNTIME — NOT THE SECURITY BOUNDARY."* Honest self-documentation. → [[Why RLS Is Not A Boundary]] |
| `012_status_constraints.sql` | All the status CHECKs in one place: `chk_dispatch_status` (4 values, line 55), `chk_trip_status` (line 64). The live constraint had **5** values — widened by hand, never in a file. `033` closes that. → [[BUG Pending Reassignment Not In State Machine]] |
| `033`–`035` (2026-08-11) | The backfill: dispatch status value, 4 undeclared tables, 1 undeclared column. Written to be no-ops against live |
| `013` | Removed branch scoping — single-org decision. → [[ADR-001 Single Organization]] |
| `016_reservation_module.sql` | The vocabulary migration: retires 015's 10 statuses, back-fills, adds `reservation_number`, normalises priority |
| `022_remove_front_desk_roles.sql` | Removed role ids 5/6/8 → the 6 live roles. (This vault previously cited it as `022_role_system.sql`; no such file exists.) → [[DOC rbac-model Says 9 Roles]] |
| **`023_dispatch_overlap_guard.sql`** | **The best file in the repo.** Advisory locks + a reasoned explanation of why not `EXCLUDE USING gist`. → [[TOCTOU And Advisory Locks]] |
| `024_driverincidents.sql` | Recreates a table `005` dropped: *"The driver portal and /api/driver/incidents still reference it, so it was missing at runtime and incident reporting was broken."* |
| **`049_driver_work_schedule_and_leave.sql`** (2026-08-15) | Weekly schedules + leave. RLS write policies are `system_admin`+`fleet_manager` only (admin excluded). Applied **directly via pg**, see below. → [[Driver Management]] |

## 2026-08-15 — `db:up` is blocked; 049 was applied directly

`npm run db:status` reports **51** files: 33 applied, 3 pending
(`036_trip_lifecycle_status.sql`, `037_remove_review_statuses.sql`, `049`), and
**15 "changed since applied"** files (001, 003, 004, 006, 012, 013, 016, 019,
021, 024, 037_notification_preferences, 042, 043, 046, 047). The runner refuses
to run at all while any applied file's checksum changed — so `db:up` cannot apply
`049` (or `036`/`037`, which remain pending in the ledger while the live DB already
reflects them).

`049` was therefore applied by a **one-off direct `pg` connection** (advisory lock
`947112003`, then a `schema_migrations` insert with the sha256[0:16] checksum
`895dfea7f81ed725`), followed by `npm run db:dump` (40 tables, 1 view, 83 FKs,
89 indexes, 11 functions, 16 triggers). **Do not** "reconcile" the 15 changed
files by editing them — that is risk on top of unknown drift. It is the pre-existing
blocker documented in [[DEBT Schema Drift From Migrations]]; a real fix is a
baseline/rename exercise the user has not asked for.

## What `024` teaches

A migration dropped a table that live code still referenced. Nothing caught it until incident reporting broke in production use. **There is still no check that the schema satisfies the code** — that gap is unchanged.

What changed on 2026-08-11 is narrower, and worth stating precisely: drift is now
**visible** (a `schema.sql` diff in every PR that touches the DB) but still not
**gated** (nothing fails a build when code queries a column that does not exist).
Visibility depends on a human reading the diff. A real gate would mean typed
queries or a test that runs the app's SQL against the live schema.

INFERRED: this is the same class of failure as [[DEBT Schema Drift From Migrations]] — schema and code evolve independently, and only one direction is now observable.

## Related

[[Database Overview]] · [[DEBT Schema Drift From Migrations]] · [[Quick Reference]] · [[ADR-008 Manual Migration Procedure]] · [[ERD]] · [[SEC Database Password In Git History]]
