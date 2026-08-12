---
type: bug
status: closed
severity: sev-1
tags: [security, secrets, database, git]
source:
  - run_sql.mjs (deleted 2026-08-11, still in git history)
last_verified: 2026-08-11
---

# SEC: Database Password In Git History

> **CLOSED 2026-08-11 — password rotated.** The leaked value
> `GWQsgVVjhsLHrJvS` is now rejected by the server (`password
> authentication failed`), and `.env` carries a new password that connects
> and runs the full toolchain. History still contains the old value, which is
> now worthless; rotation is what closed this. The note below is the record
> of the finding.

## The finding — CONFIRMED

The deleted root script `run_sql.mjs` contained the live Supabase database
password and host **as a hardcoded string literal**, not read from `.env`.
The file was committed, so it is in the repository history.

It was deleted in the 2026-08-11 schema-reproducibility commit. **Deleting a
file does not remove it from git history.** Anyone with the repo — including
anyone who ever cloned it, and any fork or backup — can recover the password
with a single `git log -p` or `git show <sha>:run_sql.mjs`.

**Exposure window — CONFIRMED via `git log -S`:**

| | Commit |
|---|---|
| Introduced | `fb3124e` "rbac updated using auth.js and pg" |
| Removed | `cbca742` "Make the database schema reproducible from the repo" |

`git grep` confirms **no tracked file at HEAD contains the value**, and
`.env` is both gitignored (`.gitignore:34`) and untracked. `run_sql.mjs` was
the only one of the nine deleted root scripts that hardcoded it — the others
read `process.env`. So the current tree is clean and history is not.

## Why this is severity 1

The credential is for the **production Supabase project the app actually
uses** (`dnxuphhxlzidvwtdqqkq`, db `postgres`). The hardcoded user is
`postgres` — the database superuser — so it grants full read/write plus DDL.
It can `DROP TABLE`.

It also bypasses RLS entirely, which is the exact reason
[[Why RLS Is Not A Boundary]] exists as a note. The script also disabled
certificate verification (`ssl: { rejectUnauthorized: false }`), so it was
additionally open to a man-in-the-middle on the wire.

## What to do — in this order

1. **Rotate the password in the Supabase dashboard.** This is the only step
   that actually closes the exposure. Everything else is cleanup.
2. Update `DATABASE_URL` in `.env` to the new password.
3. Re-run `npm run db:status` to confirm the new credential works.
4. *Optional, and it rewrites history:* purge the blob with
   `git filter-repo` or BFG. Only worth doing if this repo will ever be
   published. **Rotation makes the leaked value worthless, so do 1 first
   and treat 4 as housekeeping.**

Do not skip step 1 on the reasoning that the repo is private. The
credential should be treated as already disclosed.

## Resolution — CONFIRMED 2026-08-11

Steps 1–3 are done:

| Check | Result |
|---|---|
| New `DATABASE_URL` password | connects as `postgres`/`postgres`, 39 tables visible |
| **Old leaked password** | **rejected** — `password authentication failed` |
| Stale copies of the old value in the working tree | none (incl. untracked files) |
| `npm run db:status` | 42 applied / 0 pending / 0 changed — ledger healthy |
| Test suite | 191 passed |
| `db:dump` vs checked-in `schema.sql` | no diff — schema unchanged by the rotation |

The counts in that table are the **pre-Phase-3 snapshot** — what the checks
returned at the moment of the rotation. They are left as recorded rather than
updated, because the point of the table is what was verified then. Current
figures (38 tables, 43 applied, 197 tests) are in [[Current State]].

Step 4 (rewriting history) is still open by choice: the repo is private and the
leaked value is now dead. If this repo is ever published, run
`git filter-repo` on the `run_sql.mjs` blob first — rotation made the secret
worthless, but the habit of the hardcode is still visible in history.

## Why it happened — INFERRED

The one-off apply scripts were written under the constraint documented in
[[ADR-008 Manual Migration Procedure]]: no `supabase` CLI, no `psql`. Each
was a throwaway, and pasting the connection string inline was faster than
wiring up env loading — especially since `scripts/load-env.mjs` was
**silently broken at the time** and would have loaded nothing anyway.

That is the uncomfortable part: the broken env loader made hardcoding the
credential the path that *worked*.

## How to prevent it

- `AGENTS.md` now states: **never put credentials in a script**; use
  `scripts/load-env.mjs`, which reads `.env`.
- `.env` is gitignored. Nothing that reads it should ever inline its values.
- The one-off scripts that motivated this are gone — `npm run db:up` is the
  single path now. See [[Migrations]].

## Related

[[ADR-004 Dual Database Access]] · [[ADR-008 Manual Migration Procedure]] · [[Why RLS Is Not A Boundary]] · [[Migrations]] · [[Environment Setup]] · [[Debugging Index]] · [[Technical Debt]]
