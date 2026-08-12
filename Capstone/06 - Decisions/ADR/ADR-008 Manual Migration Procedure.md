---
type: decision
status: superseded
date: 2026-08-11
superseded_by: "the ledger + runner built the same day — see 'Update' below"
tags: [decision, adr, migrations, tooling]
source:
  - AGENTS.md
  - .env
  - scripts/migrate.mjs
  - "apply029.js (deleted 2026-08-11)"
last_verified: 2026-08-11
---

# ADR-008: Manual Migration Procedure

> **Status: superseded on the day it was written.** The "Recommended
> improvement" below was built and is now the working procedure —
> `npm run db:status` / `db:up` / `db:dump`. The record above the Update
> section is left unedited, because *why* the manual procedure existed is
> still the reason the replacement connects the way it does.

## Context

Migrations must reach the live Supabase project. The normal tool is the `supabase` CLI.

## Decision — CONFIRMED

**Hand-written Node scripts using `pg` + the real `DATABASE_URL`**, run from the repo root so `pg` resolves from `node_modules`. Wrap in `BEGIN; … COMMIT;`, then verify via `information_schema`.

Existing examples: `apply029.js`, `apply030.js`, `run_migration_031.mjs`.

## The stated reasons — one is FALSE

`AGENTS.md` gives three:

| Claim | Verdict |
|---|---|
| `psql` and `docker` unavailable | ✅ **True** |
| The Supabase SQL editor silently targeted a different project | ✅ **Plausible and serious** — a migration that appears to apply but doesn't is the worst failure mode |
| `.env` line 8 is *"an orphaned token (a bare host string with no `=`)"* breaking CLI parsing | ❌ **FALSE** |

**Verified:** all 10 `.env` lines are well-formed `KEY=VALUE`. Line 8 is `DATABASE_URL=…`. Line 1 does carry a **UTF-8 BOM**, which is a plausible real cause of a parser complaining — but that is not what `AGENTS.md` says.

**So: the procedure is sound, the documented justification is not.** Worth recording because someone will eventually "fix" `.env` line 8, find nothing wrong, and conclude the whole procedure is cargo cult. It isn't — the SQL-editor-targeting-the-wrong-project reason alone justifies it.

INFERRED: the BOM on line 1 was the actual trigger, misdiagnosed as a line-8 problem.

## Consequences

**Good:**
- It works, and it verifies — `information_schema` confirmation is built into the procedure
- Explicit transactions
- No dependency on unavailable tooling

**Costs — these are the source of real problems:**
- **No ledger.** Nothing records which migrations have been applied. → [[DEBT Schema Drift From Migrations]]
- ~10 one-off scripts accumulated in the repo root
- Numbering broke: `008` missing, `019` ×3, six other duplicates
- Four live objects have no migration file at all (`ailogs`, `system_settings`, `substitute_vehicle_schedules`, ~~`driver_stats`~~ — **correction:** `driver_stats` is a **view**, not a table. The fourth undeclared *table* was `ai_report_narratives`.)

## Recommended improvement

Keep the `pg` connection approach — it's the part that works. Add the part that's missing:

1. One `scripts/migrate.mjs` that reads `supabase/migrations/`, applies pending files in order, and records each in a `schema_migrations` table
2. A `scripts/dump-schema.mjs` writing live `information_schema` to a checked-in `schema.sql`
3. Delete the one-off root scripts

That gives a ledger and a reproducible target without needing the CLI.

## Update — implemented 2026-08-11 (commit `cbca742`)

All three were built. What the plan got wrong, and what the build had to decide:

**The ledger is keyed on filename, not version number.** The plan assumed
versions were unique. They are not — `011`, `013`, `014`, `017`, `018` and `030`
each appear twice, `019` three times, and `008` does not exist. Keying on
version would have silently skipped real migrations. Replay order is therefore
filename order, which is *deterministic* but not *meaningful*; renumbering is
still open. → priority 2 in [[Current State]]

**Applied migrations are checksummed.** `db:status` reports
`changed-since-applied` and `db:up` refuses to run and exits 1 if a file that is
already in the ledger has been edited. Verified by a deliberate tamper test.

**The 39 pre-existing migrations were back-filled into the ledger as applied,
not replayed.** They were already live; re-running them would have been
destructive at worst and noise at best.

**Nine one-off root scripts were deleted, not ten.** One of them —
`run_sql.mjs` — turned out to have hardcoded the live database password. Deleting
the file does not remove it from git history. That is now the highest-severity
open item in this vault. → [[SEC Database Password In Git History]]

**The undeclared objects were declared, not dropped.** Migration `034` declares
`ailogs`, `ai_report_narratives`, `system_settings` and
`substitute_vehicle_schedules`; `035` adds `driverincidents.assistance_needed`.
`substitute_vehicle_schedules` holds **1 live row**, so dropping it is a product
call, not a cleanup call. → [[DEBT Schema Drift From Migrations]]

The commands are now:

```bash
npm run db:status   # applied / pending / changed-since-applied
npm run db:up       # apply pending migrations
npm run db:dump     # regenerate schema.sql from live
```

**What did not change:** the connection method. `scripts/migrate.mjs` uses `pg` +
`DATABASE_URL` via `scripts/load-env.mjs`, for exactly the reasons in Context
above. The CLI is still unusable, the SQL editor is still untrustworthy. This
ADR's decision was replaced; its *reasoning* was not.

One more thing surfaced en route: `scripts/load-env.mjs` had been loading **zero**
credentials for every verification script in the repo, and reporting success.
→ [[Verification Tooling Can Be Dead]]

## Related

[[Migrations]] · [[DEBT Schema Drift From Migrations]] · [[Quick Reference]] · [[Environment Setup]] · [[Decision Log]]
