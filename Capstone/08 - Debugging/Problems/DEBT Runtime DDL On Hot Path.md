---
type: debt
status: fixed
severity: sev-2
tags: [debt, ai, database, performance]
source:
  - src/lib/ai/logger.js
  - src/app/api/ai/logs/route.js
  - src/app/api/ai/providers/route.js
  - supabase/migrations/034_backfill_undeclared_tables.sql
last_verified: 2026-08-11
---

# Debt: Runtime DDL On Hot Path

> **FIXED 2026-08-11.** All three `CREATE TABLE IF NOT EXISTS` calls removed;
> the tables are declared by migration 034 instead. See [[DEBT Runtime DDL On Hot Path#The fix]].

## Symptom — CONFIRMED (the before-state)

Three files **used to** issue `CREATE TABLE IF NOT EXISTS` **inside a request
handler**. Line numbers are historical — the DDL is gone from all three:

| File | Line (before fix) |
|---|---|
| `src/lib/ai/logger.js` | 21 |
| `src/app/api/ai/logs/route.js` | 10 |
| `src/app/api/ai/providers/route.js` | 10 |

This is how `ailogs` (731 rows — the **largest table in the database**) and `ai_report_narratives` came to exist without a migration file.

## Why it's a problem

1. **DDL takes locks.** `CREATE TABLE IF NOT EXISTS` acquires a lock on the system catalogs on every call. Fine at demo scale, a contention point under load.
2. **It requires elevated privileges at runtime.** The app connects as owner, so it works — see [[ADR-004 Dual Database Access]]. An app that can `CREATE TABLE` can also `DROP` one.
3. **The schema becomes invisible.** `ailogs` appears in no migration, so the migration history lies. → [[DEBT Schema Drift From Migrations]]
4. **Silent divergence.** If the code's `CREATE TABLE` definition ever changes, `IF NOT EXISTS` makes it a **no-op** on an existing table. The code and the live table can drift with no error.

Point 4 is the dangerous one: the guard that makes this safe is exactly what hides the drift.

## The fix

Exactly the plan below, in that order. All three DDL blocks are gone,
replaced by a one-line comment naming the migration that owns the table —
following the precedent already set at `src/lib/ai/llm-adapter.js:5-11`,
where someone had done this correctly before.

**Point 4 was not hypothetical.** When dumping the live definitions for
migration 034, the runtime DDL in `providers/route.js` had *already* drifted:
it omitted `target_feature`, a column the live table has. The `IF NOT EXISTS`
guard had been hiding that difference. So 034 was transcribed from the **live
dump**, not from the code — had I copied the code, the migration would have
declared a table the database does not actually have.

A missing table now fails loudly, which is the correct behaviour: that is a
deployment error, not something to repair per-request.

## Why it happened — INFERRED

AI logging was added after the migration workflow had already become painful (`AGENTS.md` documents the CLI being unusable). Creating the table in code was the path of least resistance. It worked, so it stayed.

**This is the general shape of technical debt:** a shortcut that solves today's friction and quietly relocates the cost.

## Related

[[AI Architecture]] · [[AI Advisory]] · [[DEBT Schema Drift From Migrations]] · [[Technical Debt]] · [[Debugging Index]]
