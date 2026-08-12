---
type: architecture
title: Supabase
tags: [architecture, supabase, database]
source:
  - src/lib/db.js
  - supabase/migrations/002_rls_policies.sql
  - .env
last_verified: 2026-08-11
---

# Supabase

Supabase is used as **managed Postgres**. Almost none of the platform features are in play.

## What is used — CONFIRMED

| Feature | Used? | Note |
|---|---|---|
| Postgres | ✅ | Project `dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public` |
| Service-role client | ✅ | `getAdminClient()` in `src/lib/db.js` |
| Direct `pg` connection | ✅ | `DATABASE_URL` — bypasses the Supabase client entirely |
| Storage | INFERRED yes | `face_image_url`, `license_image_url` columns suggest it |
| **Supabase Auth** | ❌ | Login is NextAuth against `employees.password_hash` |
| **RLS as a boundary** | ❌ | 71 policies, all inert |
| **Realtime** | UNKNOWN | Not observed in the code read so far |
| **Edge Functions** | ❌ | None in the repo |

## The important consequence

Because the app connects with the **service role key** *and* as the **database owner** via `pg`, it never assumes an end-user Postgres identity. RLS policies evaluate against a privileged role and therefore never restrict anything.

`supabase/migrations/002_rls_policies.sql:1-12` says so itself:

> *"⚠️ INERT AT RUNTIME — NOT THE SECURITY BOUNDARY."*

That header is the single most valuable line of documentation in the repository. It prevents exactly the mistake most people make with Supabase: assuming RLS is protecting them.

→ [[Why RLS Is Not A Boundary]] · [[ADR-004 Dual Database Access]]

## Why RLS exists at all if it's inert — INFERRED

Three plausible reasons, none documented:
1. Defence in depth if the app ever adds an anon-key client path
2. A remnant of an earlier Supabase-Auth design (consistent with [[BUG Root proxy.js Is Dead Code]])
3. Documentation of *intended* access rules, in SQL form

The repository does not currently document why this decision was made.

## The CLI does not work here — CONFIRMED

`supabase` CLI, `psql`, and `docker` are all unusable in this environment, and the Supabase **SQL editor was found unreliable** — applies silently landed on a different project. The working path is a `pg` script. → [[Quick Reference]] · [[ADR-008 Manual Migration Procedure]]

## Related

[[Database Overview]] · [[Why RLS Is Not A Boundary]] · [[Authentication]] · [[Migrations]] · [[Architecture]]
