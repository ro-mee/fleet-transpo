---
type: memory
title: Deployment Knowledge
tags: [memory, deployment, unknown]
source:
  - next.config.mjs
  - src/lib/auth/mfa.js
  - src/lib/auth/mobile-token.js
  - src/lib/api/utils.js
  - supabase/migrations/087_auth_security_lifecycle.sql
  - supabase/migrations/088_auth_sessions_mfa.sql
  - supabase/migrations/089_session_idle_timeout.sql
  - .env
last_verified: 2026-09-03
---

# Deployment Knowledge

> **Mostly UNKNOWN.** There is no deployment configuration in this repository — no Dockerfile, no CI workflow, no `vercel.json`, no deploy script. What follows is what the repo *does* establish, kept separate from what it doesn't.

## What's CONFIRMED

| Fact | Evidence |
|---|---|
| Supabase project | `dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public` |
| Two privileged credentials | `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` — both bypass RLS → [[ADR-004 Dual Database Access]] |
| Configuration is local `.env` plus hosting-provider environment variables | 12 local keys; production also requires `MOBILE_JWT_SECRET` and `MFA_ENCRYPTION_KEY`; no `.env.production` → [[Environment Setup]] |
| No CI | no `.github/workflows/` |
| Mobile is Expo | `npx expo start`; no EAS config committed |
| CORS is fail-closed | `src/proxy.js` allows same-origin/no-Origin requests and the configured `NEXT_PUBLIC_APP_URL` origin only → [[Technology Stack]] |

`next.config.mjs` carries a cache-busting comment (`// Invalidate Turbopack cache: 2026-08-07T14:30:45`) — a local build workaround, not deployment config.

## What's UNKNOWN

- Where the web app is or will be hosted
- Whether a staging environment exists
- How migrations would run in a deploy
- How the mobile app is distributed (EAS? sideloaded dev build?)
- Whether anything is currently deployed at all

**The repository does not currently document why these decisions were made** — or whether they've been made.

## Before anything is deployed

Ordered, and the first two are non-negotiable:

1. **Add production env keys.** `MOBILE_JWT_SECRET` must be distinct from `NEXTAUTH_SECRET`; `MFA_ENCRYPTION_KEY` must be a stable dedicated 32-byte key; `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, and `BOOKING_GATEWAY` enable their protected integrations. Missing auth secrets fail closed; missing Booking keys leave the gateway mocked or reject inbound calls. → [[Things That Might Break]]
2. **Route-auth audit.** 162 routes, per-route discipline. `npm run verify:auth` currently checks 220 exported methods, including explicit service-token and public protocol exceptions. → [[Authentication]]
3. ~~**Lock CORS** to known origins.~~ **Done:** `src/proxy.js` is fail-closed and allows only the configured `NEXT_PUBLIC_APP_URL` browser origin.
4. ~~**Make the schema reproducible.**~~ → **done 2026-08-11** (Phase 2): `schema.sql` is checked in, migrations 034/035 declare the four undeclared tables, and a `schema_migrations` ledger records what has been applied. Caveat: the rebuild path is `schema.sql` + `migrate.mjs baseline`, **not** `db:up`, and it has never been executed. → [[Migrations]]
5. ~~**Remove runtime `CREATE TABLE`.**~~ → **done 2026-08-11** (Phase 2). The DDL had also drifted from the real table. → [[DEBT Runtime DDL On Hot Path]]
6. **Get tests running, then one CI job.** Tests run (**487 across 46 files**); there is still no CI. Lint + tests + `db:status` would be the job. Note what a green run does *not* prove: the suite does not replace live deployment and database verification. → [[Roadmap]] · [[Things I Should Not Forget]]

## The credential rule

Privileged keys and auth signing/encryption keys carry no `NEXT_PUBLIC_` prefix, which is correct — that prefix is what Next uses to decide what ships to the browser. The live hazard is **importing a server module into a client component**, which would bundle whatever it reads. `src/services/` mixing server and client modules under one folder name is what makes that easy to do by accident. → [[DEBT Services Folder Mixes Two Concerns]]

## Related

[[Environment Setup]] · [[Important Commands]] · [[Things That Might Break]] · [[Roadmap]] · [[ADR-008 Manual Migration Procedure]]
