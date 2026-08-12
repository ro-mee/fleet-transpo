---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, database, security]
source:
  - src/lib/db.js
  - supabase/migrations/002_rls_policies.sql
last_verified: 2026-08-11
---

# ADR-004: Dual Database Access

## Context

The app needs to reach Supabase Postgres. Supabase provides a JS client; Postgres also accepts a direct connection via `pg`.

## Decision — CONFIRMED

**Both**, from `src/lib/db.js`:

| Path | Identity | Use |
|---|---|---|
| `getAdminClient()` | Supabase **service role key** | Supabase-style queries, storage |
| `getPool()` / `query()` | Postgres **owner** via `DATABASE_URL` | Raw SQL, transactions |

## Why the `pg` path exists — CONFIRMED

The `withTransaction` docstring (`src/lib/db.js:56-72`) gives the concrete reason:

> `query()` checks a connection out per call, so two statements from it can land on different clients and cannot share a transaction. Anything that must be all-or-nothing needs this instead — notably reassigning a driver's vehicle, where the old pairing has to close and the new one open atomically or the `uq_dva_active_*` partial unique indexes reject the pair mid-flight.

The Supabase JS client has no transaction primitive. Driver reassignment needs one. Hence `pg`.

**The reason for keeping *both* rather than migrating fully to `pg` is not documented.** INFERRED: the Supabase client came first, `pg` was added when transactions were needed, and neither was removed.

## Consequences

**The big one: RLS can never be the security boundary.** Both paths hold elevated privileges. No end-user Postgres identity is ever established, so the 71 RLS policies on 32 tables evaluate against a privileged role and never restrict anything.

`supabase/migrations/002_rls_policies.sql:1-12` says so:

> *"⚠️ INERT AT RUNTIME — NOT THE SECURITY BOUNDARY."*

→ [[Why RLS Is Not A Boundary]]

**Other consequences:**
- Every security guarantee rests on `requireAuth()` in application code → [[Authentication]]
- An app that can `CREATE TABLE` at runtime can also `DROP` one → [[DEBT Runtime DDL On Hot Path]]
- Two connection pools to manage, two failure modes, two sets of credentials in `.env`
- A developer must know which path to use for a given task, and nothing enforces it

## Revisit if

- The app ever adds an anon-key path for end users — then RLS becomes live and the policies matter
- Credential blast radius becomes a concern (a leaked service role key is total DB access)
- The Supabase client's remaining uses could be replaced by `pg`, collapsing to one path

## Related

[[Why RLS Is Not A Boundary]] · [[Supabase]] · [[Connection Pooling vs Transactions]] · [[driver_vehicle_assignments]] · [[Decision Log]] · [[Backend]]
