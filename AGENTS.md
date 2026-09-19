## Mandatory repository pre-flight

Before planning, editing, running implementation commands, or making any other task changes, read `.agents/AGENTS.md` in full and follow it as mandatory repository policy. Then read the relevant `Capstone/` notes before implementation and update the relevant notes after behavior, architecture, data, or workflow changes.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase migrations — apply via direct DB connection

The `supabase` CLI is NOT usable in this repo because `psql`/`docker` are unavailable. Pasting migration SQL into the Supabase SQL editor was found UNRELIABLE — applies there were silently not landing on the project the app actually uses (`dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public`) because the browser editor can target a different project/DB.

The reliable path is a direct connection using `pg` + the real `DATABASE_URL` from `.env`. **Do not hand-write a one-off script for this — there is a runner:**

```
npm run db:status   # applied / pending / changed-since-applied
npm run db:up       # apply pending, each in its own transaction
npm run db:dump     # refresh schema.sql from the live DB
```

`scripts/migrate.mjs` records every apply in the `schema_migrations` ledger, keyed by **full filename** (version numbers 036, 037, 059 and 060 are duplicated historically — this exact set is frozen by `npm run db:check`, which also validates filenames and runs without a DB). It refuses to run if an already-applied file's checksum changed, and it applies in filename order inside `BEGIN; ... COMMIT;`.

Rules when adding a migration:

- Write `supabase/migrations/NNN_name.sql` and check `npm run db:status` first — do not reuse a number. **`ls supabase/migrations/` is not sufficient**: the ledger records migrations whose files are gone (as of 2026-09-18: `113_maintenance_repairer_identity`, `114_app_errors_rls`, `115_rls_gap_tables`), so a version can be spent without appearing on disk. `db:status` lists those under "in the ledger but missing from disk"; treat every version it shows as taken.
- Make it idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`). The live DB is ahead of the files in places, so a migration must be a safe no-op there.
- Apply with `npm run db:up`, then `npm run db:dump` and commit the `schema.sql` diff. That diff is the review artifact — **except for RLS**, which `schema.sql` does not capture at all (it contains no policies), so an RLS migration needs a `pg_policies` query against live before it can be reviewed.
- Verify presence via `information_schema` / `pg_constraint`, and re-run the app's real queries against live to confirm nothing broke.

`schema.sql` is generated — never edit it by hand. Never put credentials in a script; `scripts/load-env.mjs` reads `.env`.

# PostgREST / anon-key exposure — check it after any migration that creates a table

Supabase exposes PostgREST at `<project>.supabase.co/rest/v1/`. The **public anon key** — which ships in the browser bundle by design — authenticates to it as the `anon` role. That role **is** subject to RLS, and **no application code runs on that path**. So a table in `public` with RLS disabled is readable by anyone holding the anon key.

```
npm run verify:anon   # probes every table AND view in schema.sql using the anon key ALONE
npm run db:contract   # reads the live catalog: RLS state, grants, policies, classifications
```

Read-only by construction; neither prints the key. Verdicts: rows returned → **EXPOSED**; explicit refusal → **PASS**; `200 []` → **INCONCLUSIVE, never PASS** — an empty table and a policy-denied one are indistinguishable from outside, and calling that "safe" is the false confidence this exists to prevent.

`db:contract` is what resolves `INCONCLUSIVE`, and the two are a pair: the probe is the end-to-end question, the contract is the explanation. A table is only closed when the DB side accounts for the probe's result. **`200 []` resolved against us once already** — `ai_prompt_templates` and `trip_monitor_alerts` were empty, not protected (both closed by migration `115`, 2026-09-18).

**Enabling RLS is NOT sufficient while the table still holds grants.** Row security does not apply to `TRUNCATE`, so a table with RLS on and an `anon` TRUNCATE grant is still one statement away from being emptied by anyone with the public anon key. Migration `115` had to `REVOKE ALL PRIVILEGES … FROM anon, authenticated` as well, and that revoke is load-bearing rather than decorative. Check the grant list, not just `relrowsecurity`.

**A new view needs `security_invoker` AND no anon grant.** `reloptions` tells you: null means it executes as its OWNER and reads straight through the RLS protecting its base tables. RLS on the base tables does not cover it.

**A new table must enable RLS explicitly.** Migration `100` is a one-time list of 20 tables, not a standing rule — tables created after it do **not** inherit it. That is exactly how `app_errors` (readable with the anon key, `stack` column included), `ai_prompt_templates` and `trip_monitor_alerts` ended up exposed. See `Capstone/07 - Development/Bugs.md`, SEC-DB-003.

**A new VIEW needs checking too, and RLS on its base tables does not cover it.** A view executes as its owner unless it sets `security_invoker`, so it reads straight through the RLS protecting what it selects from — that is SEC-DB-006, where `driver_stats` exposed driver performance rows and the probe never looked because it enumerated `CREATE TABLE` only. Register every view in `scripts/lib/schema-contract.mjs` under `VIEWS`; the offline gate fails if one is missing.

**`schema.sql` will not show this.** `dump-schema.mjs` emits structure only — zero `ROW LEVEL SECURITY` and zero `GRANT` statements — so the review artifact is blind to RLS changes; migration `114` produced an **empty diff**. Do not read a clean `schema.sql` diff as "RLS is fine" (SEC-DB-004). `npm run db:contract` is the gate that sees it.

**The schema contract is two shared files**, `scripts/lib/schema-contract.mjs` (classifications) and `scripts/lib/sql-references.mjs` (SQL extraction) — in `scripts/lib/` as `.mjs` because this repo has no `"type": "module"`, so a `.js` file under `src/` is CommonJS to plain `node` and `db:contract` could not load it. Adding a table means adding it there, or `npm test` fails.
