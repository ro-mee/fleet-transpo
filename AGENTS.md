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

- Write `supabase/migrations/NNN_name.sql` and check `ls supabase/migrations/` first — do not reuse a number.
- Make it idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`). The live DB is ahead of the files in places, so a migration must be a safe no-op there.
- Apply with `npm run db:up`, then `npm run db:dump` and commit the `schema.sql` diff. That diff is the review artifact.
- Verify presence via `information_schema` / `pg_constraint`, and re-run the app's real queries against live to confirm nothing broke.

`schema.sql` is generated — never edit it by hand. Never put credentials in a script; `scripts/load-env.mjs` reads `.env`.
