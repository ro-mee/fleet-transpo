---
type: reference
title: Quick Reference
tags: [reference, commands]
source:
  - package.json
  - AGENTS.md
  - mobile/package.json
last_verified: 2026-08-11
---

# Quick Reference

## Commands — CONFIRMED (`package.json`)

```bash
npm run dev        # next dev
npm run build      # next build
npm run start      # next start
npm run lint       # eslint       — 38 errors / 33 warnings, all pre-existing UI issues
npm run test       # vitest       — watch mode
npm run test:run   # vitest run   — ✅ 16 files, 197 tests, all passing

npm run db:status  # migrations: applied / pending / changed-since-applied
npm run db:up      # apply pending migrations, filename order, each in a txn
npm run db:dump    # regenerate schema.sql from the live database
```

> Install with the pin — `npm i -D vitest@^3.2.7`. A bare `npx vitest` resolves to **4.x**, a silent major upgrade over the declared range.

Mobile (`mobile/`): Expo SDK ~54, expo-router ~6.

## Applying a migration — CONFIRMED PROCEDURE

**Use the runner. Do not hand-write a one-off script** — that habit produced
nine throwaway scripts (`apply029.js`, `run_migration_031.mjs`, …) that each
applied one file and recorded nothing, and one of them leaked the production
password into git history ([[SEC Database Password In Git History]]).

```bash
npm run db:status   # what is applied, pending, or edited-since-applied
npm run db:up       # apply pending
npm run db:dump     # refresh schema.sql, then commit the diff
```

Write `supabase/migrations/NNN_name.sql` — `ls` the directory first, numbers are
reused — make it **idempotent** (`IF NOT EXISTS`), then apply and dump. The
`schema.sql` diff is the review artifact. Full detail in [[Migrations]].

The `supabase` CLI, `psql`, and `docker` are **not usable** here, and the
Supabase SQL editor was found unreliable — it can silently target a different
project. `scripts/migrate.mjs` connects directly with `pg` and the real
`DATABASE_URL` read from `.env` by `scripts/load-env.mjs`.

> **Caveat — CONFIRMED.** `AGENTS.md` justified this by claiming `.env` line 8 is "an orphaned token (a bare host string with no `=`)". **That is false today** — all 10 `.env` lines are well-formed `KEY=VALUE`, and line 8 is `DATABASE_URL=`. Line 1 does carry a UTF-8 BOM, and the file is CRLF; together those two broke `load-env.mjs` until 2026-08-11. The *procedure* was sound; the stated *reason* was not.

**Always verify after applying** via `information_schema`, then re-run the app's runtime queries.

## Framework gotchas — CONFIRMED

| Gotcha | Detail |
|---|---|
| **No `middleware.js`** | Next 16 renamed it. `src/proxy.js`, exporting `proxy()`. CORS only. |
| **Two `proxy.js` files** | Root one is dead and contradicts real auth. [[BUG Root proxy.js Is Dead Code]] |
| **Read the bundled docs** | `AGENTS.md`: read `node_modules/next/dist/docs/` before writing Next code |
| **Expo docs are versioned** | `mobile/AGENTS.md`: use https://docs.expo.dev/versions/v57.0.0/ |
| **Tailwind v4** | CSS-first config, no `tailwind.config.js` |

## Live database — CONFIRMED

- Project ref `dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public`
- **38 tables + 1 view (`driver_stats`), 77 FKs**, 84 standalone indexes, 11 functions, 16 triggers
- Structure is checked in at `schema.sql` — generated, never hand-edited
- **RLS enabled on 32 tables with 71 policies — all inert.** See [[Why RLS Is Not A Boundary]]

> Counted from `schema.sql` (`grep -c '^CREATE TABLE'`). One of the 39 is
> `schema_migrations`, the ledger created on 2026-08-11 — so live held 38 before
> today and genuinely gained one table. **How this vault arrived at "37" is not
> recorded**, and I did not reconstruct it; treat the old figure as unverified
> rather than as a count of something specific.

## Vault upkeep

After changing code, update notes whose `source:` lists the file you touched:

1. Search the vault for the file path
2. Fix the note body
3. Bump `last_verified:`
4. If a claim's status changed, update its **CONFIRMED / INFERRED / UNKNOWN** label

A note older than ~2 months with no `last_verified` bump should be treated as suspect. That is precisely how `docs/rbac-model.md` came to claim 9 roles when there are 6.

## Related

[[Home]] · [[Environment Setup]] · [[Current State]] · [[Technology Stack]]
