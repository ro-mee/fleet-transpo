---
type: memory
title: Important Commands
tags: [memory, commands, reference]
source:
  - package.json
  - mobile/package.json
  - AGENTS.md
last_verified: 2026-08-11
---

# Important Commands

## Daily

```bash
npm install
npm run dev                  # web — next dev
cd mobile && npx expo start  # driver app
npm run lint
```

## Tests

```bash
npm run test:run             # ✅ 16 files, 197 tests, all passing
npm run test                 # watch mode
npx vitest run src/lib/driver/grounding.test.js   # one file
```

**Install with the pin:** `npm i -D vitest@^3.2.7`. A bare `npx vitest` resolves to **4.x** — a silent major upgrade past the declared range. → [[DEBT Vitest Not Installed]]

Config lives in `vitest.config.mjs` (`environment: "node"`, `include: ["src/**/*.test.js"]`, `@` → `./src`). Tests are **colocated**, not in `__tests__/`.

> Remember what green means here: the suite passed while a sev-1 bug was live, because one test asserted the bug. → [[Tests Can Encode Bugs]]

## Lint

```bash
npm run lint                 # 38 errors / 33 warnings, all pre-existing UI issues
```

Group the output by rule to find real bugs in the noise:

```bash
npm run lint -- -f json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m={};for(const f of JSON.parse(s))for(const x of f.messages)m[x.ruleId]=(m[x.ruleId]||0)+1;for(const[k,v]of Object.entries(m).sort((a,b)=>b[1]-a[1]))console.log(String(v).padStart(3),k)})"
```

That is how the unimported JSX identifiers were found among the noise.
**`no-undef` is now ON** for plain `.js` too (enabled 2026-08-11), so this
catches the whole bug class rather than only the JSX half — it immediately
surfaced a 4th instance. → [[BUG AuthError Not Imported]]

If it ever reports hundreds of errors in `__d` / `ErrorUtils` /
`nativePerformanceNow`, you are linting `mobile/dist/**` — gitignored Expo
build output, excluded in `eslint.config.mjs`. It produced **772 of 773**
errors before exclusion and buries everything real.

## Database — the only working path

```bash
npm run db:status   # applied / pending / changed-since-applied
npm run db:up       # apply pending migrations
npm run db:dump     # regenerate schema.sql from live
```

`supabase` CLI, `psql`, and `docker` are all **unavailable** here. Pasting SQL into the Supabase web editor was found unreliable — applies silently landed on a different project. → [[ADR-008 Manual Migration Procedure]]

**Do not hand-write a one-off apply script.** That habit produced nine
throwaway scripts, and one of them hardcoded the production password into git
history → [[SEC Database Password In Git History]]. `scripts/load-env.mjs`
reads `.env`; never inline a credential.

For a genuine one-off query (not a migration), write the script **in the repo
directory** so it resolves `pg` from `node_modules`, and import the loader:

```js
import { loadEnvLocal } from "./scripts/load-env.mjs";
import pg from "pg";
loadEnvLocal();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
```

Note: no `ssl` option — the connection string already carries it. Passing
`ssl: { rejectUnauthorized: false }` fails with *"The server does not support
SSL connections"*.

Then **verify against `information_schema`** and re-run the app's real queries.

## Queries worth keeping

```sql
-- what a constraint ACTUALLY permits (not what the migration says)
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'dispatchschedules'::regclass;

-- real column names, before writing any query
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'system_settings';

-- row counts — check before believing any report
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

-- which trip statuses have ever occurred
SELECT status, count(*) FROM trips GROUP BY status;

-- unprocessed integration rows
SELECT * FROM integration_log WHERE status <> 'processed';
```

→ [[Debugging Techniques]]

## Framework docs

`AGENTS.md` requires reading `node_modules/next/dist/docs/` before writing code — Next 16 differs from most published material. → [[Framework Version Drift]]

## Related

[[Quick Reference]] · [[Environment Setup]] · [[Debugging Techniques]] · [[Deployment Knowledge]]
