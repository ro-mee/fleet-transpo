---
type: debt
status: resolved
severity: sev-2
tags: [debt, database, migrations, schema]
source:
  - supabase/migrations
  - schema.sql
  - scripts/migrate.mjs
  - scripts/dump-schema.mjs
  - AGENTS.md
last_verified: 2026-08-11
---

# Debt: Schema Drift From Migrations

> **RESOLVED 2026-08-11.** Migrations 033–035 declared everything that was
> live but undeclared, `schema.sql` is checked in, and `schema_migrations`
> now records what has been applied. The evidence below is kept as the
> before-state — it is what the fix was measured against. See
> [[DEBT Schema Drift From Migrations#What was actually done]].

## The claim

**The migration files are not a faithful record of the live database.** Rebuilding from `supabase/migrations/` would not reproduce the schema the app runs against.

## Evidence — CONFIRMED (live DB, 2026-08-11)

### 1. Tables with no migration file

| Table | Rows | Note |
|---|---|---|
| `ailogs` | 731 | **Largest table in the DB.** Created at runtime — [[DEBT Runtime DDL On Hot Path]] |
| `ai_report_narratives` | 7 | Also runtime-created; **this note originally missed it** |
| `system_settings` | 2 | Holds UVVRP policy and hotel location — operationally critical |
| `substitute_vehicle_schedules` | **1** | **Zero references** in `src/` — but it is *not* empty |

`driver_stats` was listed here in the first version of this note. **That was
an error:** it is a **view**, not an undeclared table, so the real count was
**4 tables, not 3**. Verified against `information_schema.tables`.

### 2. A constraint the migrations don't describe

Live `chk_dispatch_status` permits **5** values; `012_status_constraints.sql:56` declares **4**. → [[BUG Pending Reassignment Not In State Machine]]

### 3. Migration numbering is broken — CONFIRMED

38 files. **`008` is missing entirely.** Duplicated numbers:

| Number | Copies |
|---|---|
| 011, 013, 014, 017, 018, 030 | ×2 each |
| **019** | **×3** |

Ordering is therefore ambiguous for 13 of 38 files. Apply order depends on filename sort, which is not the intended semantic order.

### 4. Ad-hoc apply scripts in the repo root

`apply029.js`, `apply030.js`, `run_migration.js`, `run_migration.mjs`, `run_migration_030.mjs`, `run_migration_031.mjs`, `run_sql.mjs`, `cleanup_orphans.js`, `migrate_incidents.js`

INFERRED: each was written for one migration and left behind. There is no single reproducible apply path.

**One of them, `run_sql.mjs`, hardcoded the live database password.** Deleting
it did not remove it from git history → [[SEC Database Password In Git History]].

## Impact

- Cannot stand up a fresh environment from the repo.
- Cannot trust a migration file as the answer to "what does the schema look like?"
- New contributors (and AI assistants) read the migrations and get the wrong picture.

## What was actually done

| Step | Result |
|---|---|
| `scripts/dump-schema.mjs` → checked-in `schema.sql` | 39 tables, 1 view, 88 FKs, 95 indexes, 13 functions, 19 triggers *(as measured on 2026-08-11, before migration 036 — now 38/1/77/84/11/16)*. No data, no owners, **no timestamp** — so any diff is a real schema change. |
| Migration 033 | Declares the 5th `chk_dispatch_status` value → [[BUG Pending Reassignment Not In State Machine]] |
| Migration 034 | Declares `ailogs`, `ai_report_narratives`, `system_settings`, `substitute_vehicle_schedules` |
| Migration 035 | Declares `driverincidents.assistance_needed`, added by the root script `migrate_incidents.js` with no migration at all |
| `scripts/migrate.mjs` + `schema_migrations` | The ledger this note identified as the root cause |
| 9 one-off root scripts deleted | One documented path: `npm run db:up` |

All three migrations are idempotent and verified as **no-ops against live** —
row counts unchanged (731 / 7 / 2 / 1). They exist so a *rebuild* works, not
to change the current database.

**Important detail:** 034's definitions were transcribed from the **live
dump**, not from the runtime `CREATE TABLE` strings in the code. The two had
already drifted — the code's `aiproviders` DDL was missing `target_feature`.
Copying the code would have declared a schema the database does not have,
which is exactly the failure mode in [[DEBT Runtime DDL On Hot Path]] point 4.

### Still open — deliberately

- **Numbering is still broken.** `008` missing, `019` ×3, six other
  duplicates. The ledger makes this *survivable* (it keys on **filename**,
  so `019_admin_role.sql` and `019_service_interval_guards.sql` are distinct
  rows) but not *correct*. Renumbering means rewriting applied history; not
  worth it now.
- **`substitute_vehicle_schedules` was declared, not dropped.** The original
  fix list said "probably drop it" on the basis of 0 rows. It has **1 row**.
  Dropping destroys data, so it stays until someone decides — [[Current State]].

## Fix — as originally suggested

1. **Write a schema-dump script.** Read live `information_schema` + `pg_constraint` into a checked-in `schema.sql`. Truth becomes reproducible even if history isn't.
2. **Backfill migrations** for `ailogs`, `system_settings`, `substitute_vehicle_schedules`, `driver_stats`.
3. **Decide on `substitute_vehicle_schedules`** — 0 rows, 0 references. Probably drop it.
4. **Renumber or freeze.** Consolidate 001–038 into one baseline; number everything after it sequentially.
5. **Delete the ad-hoc root scripts** once one documented path exists.

Steps 1, 2 and 5 are done. Step 3 was answered *no* (it has a row). Step 4 is
deferred.

## Why it happened — INFERRED

`AGENTS.md` documents that the `supabase` CLI is unusable here and prescribes hand-written `pg` scripts. Until 2026-08-11 that procedure had **no ledger** — nothing recorded which migrations were applied. Drift was the predictable outcome. The manual scripts are now retired in favour of `npm run db:up`, which records each applied migration in `schema_migrations`. → [[ADR-008 Manual Migration Procedure]]

## Related

[[Migrations]] · [[Database Overview]] · [[Debugging Index]] · [[Technical Debt]] · [[ADR-008 Manual Migration Procedure]]
