---
type: reference
title: Migrations
tags: [database, migrations]
source:
  - supabase/migrations
  - AGENTS.md
last_verified: 2026-08-31
---

# Migrations

**84** files in `supabase/migrations/`, contiguous `001`–`080` with exactly four
duplicated numbers (`036`, `037`, `059`, `060` — two files each, applied in
filename order; this set is frozen by `npm run db:check`), backed by a ledger and
a checked-in `schema.sql`.

> Counted with `ls supabase/migrations/*.sql | wc -l`. This vault said "38 files"
> for the pre-backfill state; the real number was 39. If a count here matters to
> you, re-run the command rather than trusting the note.

## How to apply one — CONFIRMED PROCEDURE

```bash
npm run db:status       # applied / pending / changed-since-applied
npm run db:up           # apply pending, in filename order, each in a transaction
npm run db:rebaseline   # (rare) re-record applied-but-edited files after an audit
npm run db:dump         # regenerate schema.sql from live
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
several were written against a schema that has since moved, and most are not
idempotent. Against an empty ledger, `up` would try to replay all 73 in filename
order and fail partway.

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

## Numbering — renumbered, then frozen — CONFIRMED 2026-08-26

The numbering described below (missing `008`, `019` ×3) was **renumbered away**:
files are now contiguous `001`–`069`. The only remaining ambiguity is four
duplicated numbers, each with exactly two files:

| Number | Copies |
|---|---|
| 036 (`dispatch_cancel_reason` / `trip_lifecycle_status`) | ×2 |
| 037 (`notification_preferences` / `remove_review_statuses`) | ×2 |
| 059 (`dispatch_push_outbox` / `fuel_submission_idempotency`) | ×2 |
| 060 (`inspection_submission_idempotency` / `remove_anon_employee_access`) | ×2 |

This exact set is **frozen by `npm run db:check`** — the ledger keys on full
filename precisely so the duplicates stay unambiguous. One ledger orphan exists
as of 2026-08-26: `070_driver_licenses_bucket.sql` is recorded in
`schema_migrations` but its file was deleted from disk; do not "fix" it by
creating a different file under that name.

## The migrations worth reading — CONFIRMED

| Migration | Why it's worth your time |
|---|---|
| `002_rls_policies.sql` | Header: *"⚠️ INERT AT RUNTIME — NOT THE SECURITY BOUNDARY."* Honest self-documentation. → [[Why RLS Is Not A Boundary]] |
| `012_status_constraints.sql` | All the status CHECKs in one place: `chk_dispatch_status` (4 values at the time), `chk_trip_status`. The live constraint had **5** values — widened by hand, never in a file; now declared by `042`. → [[BUG Pending Reassignment Not In State Machine]] |
| `042`–`046` | The reconciliation set: dispatch status value, undeclared tables (`ai_report_narratives`, `system_settings`, …), undeclared column. Written to be no-ops against live |
| `013_drop_branches.sql` | Removed branch scoping — single-org decision. → [[ADR-001 Single Organization]] |
| `018_reservation_module.sql` | The vocabulary migration: retires the earlier status list, back-fills, adds `reservation_number`, normalises priority (the review statuses went again in `037_remove_review_statuses`) |
| `028_remove_front_desk_roles.sql` | Removed role ids 5/6/8 → the 6 live roles. (This vault previously cited it as `022_role_system.sql`; no such file exists.) → [[DOC rbac-model Says 9 Roles]] |
| **`029_dispatch_overlap_guard.sql`** | **The best file in the repo.** Advisory locks + a reasoned explanation of why not `EXCLUDE USING gist`. → [[TOCTOU And Advisory Locks]] |
| `030_driverincidents.sql` | Recreates a table `005` dropped: *"The driver portal and /api/driver/incidents still reference it, so it was missing at runtime and incident reporting was broken."* |
| **`049_driver_work_schedule_and_leave.sql`** (2026-08-15) | Weekly schedules + leave. RLS write policies are `system_admin`+`fleet_manager` only (admin excluded). Applied **directly via pg**, see below. → [[Driver Management]] |

## 2026-08-15 — `db:up` is blocked; 049 was applied directly — RESOLVED 2026-08-20

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
blocker documented in [[DEBT Schema Drift From Migrations]].

**RESOLVED 2026-08-20.** Root cause was **line-ending churn, not SQL drift**:
of the 26 "changed" files, 25 were proven to differ from the applied checksum only
by LF↔CRLF (each applied checksum matched the LF or CRLF form of the identical
content); the 26th (`057`) predates the current blob, but its file replays against
live as a clean no-op. `db:dump` showed no drift throughout. Two fixes landed in
`scripts/migrate.mjs`:

1. `sha()` now hashes **LF-normalized** content, so EOL flapping can never trip
   the runner again (verified: forcing a file to CRLF leaves `db:status` at
   0 changed).
2. `rebaseline` command (`npm run db:rebaseline`) re-records applied-but-edited
   files to their current checksum — the sanctioned "re-baseline deliberately"
   path, now safe to use precisely because of (1).

Ledger now: **63 applied, 0 changed, 0 pending**; `db:up` runs again.
`060` and `061` (anon-`employees` removal + seeded-hash invalidation) are in the
ledger. → [[DEBT Schema Drift From Migrations]]

## 2026-08-26 — ledger state

`npm run db:status`: **73 files, 73 applied, 0 pending, 0 changed**. Live
schema per the dump: **45 tables, 1 view, 95 FKs, 110 indexes,
14 functions, 19 triggers**.

## 2026-08-31 — Migrations 070–080 & Canonical Routes

`npm run db:status`: **84 files, 84 applied, 0 pending, 0 changed**. Contiguous `001`–`080` (with the four frozen duplicates `036`, `037`, `059`, `060`).

| Migration | Name | Purpose |
|---|---|---|
| 070 | `driver_licenses_bucket.sql` | Storage bucket creation and access policies for driver license card uploads |
| 071 | `fuel_receipt_integrity.sql` | Enforces fuel receipt constraints and verification flags |
| 072 | `cleanup_fuel_test_data.sql` | Cleans up test / dummy fuel entries from development |
| 073 | `fuel_review_remarks.sql` | Adds review remarks and audit columns for staff fuel audits |
| 074 | `vehiclemaintenance_completion_audit.sql` | Completion audit hooks for maintenance records |
| 075 | `vehiclemaintenance_completed_at.sql` | Adds `completed_at` timestamp on `vehiclemaintenance` |
| 076 | `routes_integrity.sql` | Enforces canonical location foreign keys (`origin_location_id`, `destination_location_id` $\rightarrow$ `locations`), uniqueness, active/retired lifecycle, and coordinate integrity |
| 077 | `routes_direction_labels.sql` | Adds directional labels and formatting helpers |
| 078 | `validate_routes_integrity.sql` | Validation checks on route coordinates and endpoint linkage |
| 079 | `normalize_route_arrows.sql` | Normalizes route direction arrows (replaces `↔` with `→`) |
| 080 | `backfill_hotel_location_identity.sql` | Backfills canonical hotel location identity so renames preserve `location_id` while moves retire legacy geography |

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
