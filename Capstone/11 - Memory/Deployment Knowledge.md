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
  - mobile/app.json
  - mobile/eas.json
  - .env
last_verified: 2026-09-19
---

# Deployment Knowledge

> **Mostly UNKNOWN.** There is no web deployment configuration in this repository — no Dockerfile, no CI workflow, no `vercel.json`, no deploy script. Mobile EAS configuration is committed; cloud account access remains deployment-specific.

## HostForge deployment assessment — 2026-09-19

- Target: HostForge Cloud Application Hosting, using the GitHub repository `ro-mee/fleet-transpo`, branch `main`.
- Local production build passed at commit `30f0790` with Next.js 16.2.11; no repository deployment files are needed for HostForge's automatic container build.
- Expected application settings: root `.`, Node.js 22 (or another version supported by Next.js 16), `npm ci`, `npm run build`, and `npm run start`.
- Deployment is **blocked before any remote write**: `npm install -g @hostforge/cli` returned npm `E404`, `HOSTFORGE_TOKEN` is not present in this environment, and the HostForge workspace/project IDs are not available.
- Never put a HostForge token or production environment values in Git or chat. Resume after the official CLI package source is available and the operator has authenticated locally, or use a workspace-scoped Personal Access Token through the documented environment-variable flow.
- A similarly-named public npm package (`@hostforge/cli` E404; lookalikes like InsForge/FunForge/devforge are different products) must NOT be installed as a substitute — typosquat risk. The install source must come from HostForge's own dashboard/docs.

## HostForge pre-flight — verified against this repo (2026-09-19)

- **PORT/hostname need no code change.** Installed Next 16.2.11 CLI source (`node_modules/next/dist/bin/next`): `next start --port` defaults to 3000 but reads the `PORT` env, and `--hostname` defaults to `0.0.0.0` — exactly what HostForge injects and expects. Do NOT set `PORT`/`HOST` yourself (platform-owned).
- **Health-check gap CLOSED same day.** `/` is a 307 redirect (not 2xx) and every `/api/*` was auth-guarded, so no valid probe path existed. Added `GET /api/health` (`src/app/api/health/route.js`): fixed `{ ok: true }`, no auth, no DB, no env reads — a probe that touches the database fails before migrations run. Registered in `PUBLIC_METHOD_ALLOWLIST` (`scripts/verify-route-auth.mjs`); a structural test pins the no-DB/no-env/no-guard shape. HostForge Health stage must point at `/api/health`, not `/`.
- **Build fails loud without Supabase URL.** `next.config.mjs` throws during `PHASE_PRODUCTION_BUILD` when `NEXT_PUBLIC_SUPABASE_URL` is missing (CSP img-src) — set it in the build environment, not just runtime.
- **`NEXT_PUBLIC_*` are build-time.** Changing `NEXT_PUBLIC_APP_URL`/`NEXTAUTH_URL` to the HostForge address needs a rebuild, not Apply-configuration. `proxy.js` CORS is fail-closed on `NEXT_PUBLIC_APP_URL`, and reset-link emails + NextAuth derive from it.
- **No HostForge managed database.** The app stays on Supabase (`dnxuphhxlzidvwtdqqkq`); managed MySQL/Postgres cannot replace Storage + service-role access, and its seven injected variables would sit unused. No schema step at deploy — same live DB; run `npm run db:up` locally only if `db:status` shows pending.
- **Cron stays external.** `/api/cron/sync` needs an outside scheduler calling the public URL with `CRON_SECRET`.
- Verification at time of writing: `route.test.js` 2/2, ESLint clean, `verify:auth` 278/278 (stash-verified HEAD baseline 277, delta exactly the new GET).
- **Own-Dockerfile switch (2026-09-19, same day).** Two generated-pipeline builds timed out at 2400s: `npm ci` 17min cold, the platform's own setup step 12–27min, `next build` 9min on their CPU, and image export/unpack ~13min on the ~1GB image (the second build compiled fine and died exporting). Fix committed: `output: "standalone"` in `next.config.mjs` (150MB runtime, verified by booting it locally — `/` 200, `/api/health` fixed JSON), root multi-stage `Dockerfile` on `node:24-alpine` (also silences the geoip-lite `>=24` EBADENGINE warning; local dev is v26), explicit `PORT`/`HOSTNAME`/`HEALTHCHECK`, no `NEXT_PUBLIC_*` hardcoding (read from the build env like the generated file did). `.dockerignore` excludes everything `next build` does not read — notably `.env*` (Docker ignores `.gitignore`, so without this `COPY . .` would bake `.env.local` into the image) plus `mobile/`, `Capstone/`, `supabase/`, `scripts/`.
- **Standalone does not read `.env` files.** Probing the local standalone boot: `/` 500ed with `NO_SECRET` until the secrets were passed as real env — `next start` loads `.env.local`, standalone does not. No repo impact (HostForge injects env), but local standalone testing must export env explicitly, and no secret may rely on file-loading in production.
- **`.dockerignore` broke the build with 1828 errors (2026-09-19, same day, my fault).** The file excluded `jsconfig.json` — the `@/*` alias definition — so the HostForge build failed on every `@/...` import while the local build stayed green (the file exists on disk here). Fixed by un-excluding it, plus a pin test (`src/dockerignore.build-inputs.test.js`, 9 tests) asserting the required build inputs (`package*.json`, `next.config.mjs`, `postcss.config.mjs`, `jsconfig.json`, `src/`, `public/`) survive `.dockerignore` and that `.env*` stays excluded. Lesson: verify excludes against the build's actual inputs, not by gut feel — and never trust "local build green" for a file-list bug, since local has everything.

## What's CONFIRMED

| Fact | Evidence |
|---|---|
| Supabase project | `dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public` |
| Two privileged credentials | `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` — both bypass RLS → [[ADR-004 Dual Database Access]] |
| Configuration is local `.env` plus hosting-provider environment variables | 12 local keys; production also requires `MOBILE_JWT_SECRET` and `MFA_ENCRYPTION_KEY`; no `.env.production` → [[Environment Setup]] |
| No CI | no `.github/workflows/` |
| Mobile is Expo and linked to EAS | `mobile/app.json` links project `0c1651d5-7014-48da-8227-5d9f30ea1a23` to owner `josephlopezzzz`; `mobile/eas.json` defines development, preview, and production profiles |
| CORS is fail-closed | `src/proxy.js` allows same-origin/no-Origin requests and the configured `NEXT_PUBLIC_APP_URL` origin only → [[Technology Stack]] |

`next.config.mjs` carries a cache-busting comment (`// Invalidate Turbopack cache: 2026-08-07T14:30:45`) — a local build workaround, not deployment config.

## First green HostForge deploy — 2026-09-19

- Live at `https://fleetops-fleet-and-transportation-management.hostforgeplatforms.com` (HostForge platform address, HTTPS via their reverse proxy). Manual redeploy of `fd84166`; auto-deploy did not pick up the pushes on its own.
- Final recipe that fit the 2400s limit: own-Dockerfile mode (`Dockerfile`, Node 24, standalone ~150MB), probe `/api/health`, Database None (Supabase stays external), 18 env vars with `NEXT_PUBLIC_APP_URL` = `NEXTAUTH_URL` = the platform address.
- Total failed attempts before green: 4 (missing build env → 2× timeout on the generated pipeline → 1828-error jsconfig build failure on the first own-Dockerfile attempt).
- Still open after green: browser smoke test (health JSON → login → dashboard), external cron for `/api/cron/sync`, secret rotation (several keys entered chat history during setup), mobile APK still points at the old Vercel backend URL (needs a rebuild against the HostForge URL if mobile moves over).

## What's UNKNOWN

- Where the web app is or will be hosted
- Whether a staging environment exists
- How migrations would run in a deploy
- Whether the current operator's Expo account can read the linked EAS project
- Whether the mobile app is distributed through EAS or a sideloaded dev build
- Whether anything is currently deployed at all

**The repository does not currently document why these decisions were made** — or whether they've been made.

## Before anything is deployed

Ordered, and the first two are non-negotiable:

1. **Add production env keys.** `MOBILE_JWT_SECRET` must be distinct from `NEXTAUTH_SECRET`; `MFA_ENCRYPTION_KEY` must be a stable dedicated 32-byte key; `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, and `BOOKING_GATEWAY` enable their protected integrations. Missing auth secrets fail closed; missing Booking keys leave the gateway mocked or reject inbound calls. → [[Things That Might Break]]
2. **Route-auth audit.** 162 routes, per-route discipline. `npm run verify:auth` currently checks 220 exported methods, including explicit service-token and public protocol exceptions. → [[Authentication]]
3. **Verify EAS access before a mobile build.** From `mobile/`, run `eas whoami` and `eas project:info`. The linked project is owned by `josephlopezzzz`; an `Entity not authorized` / `action=READ` error means the logged-in Expo account lacks project access. Log in as the owner or have the owner grant access/transfer the project. Do not replace `extra.eas.projectId` unless intentionally creating a new EAS project.
4. ~~**Lock CORS** to known origins.~~ **Done:** `src/proxy.js` is fail-closed and allows only the configured `NEXT_PUBLIC_APP_URL` browser origin.
5. ~~**Make the schema reproducible.**~~ → **done 2026-08-11** (Phase 2): `schema.sql` is checked in, migrations 034/035 declare the four undeclared tables, and a `schema_migrations` ledger records what has been applied. Caveat: the rebuild path is `schema.sql` + `migrate.mjs baseline`, **not** `db:up`, and it has never been executed. → [[Migrations]]
6. ~~**Remove runtime `CREATE TABLE`.**~~ → **done 2026-08-11** (Phase 2). The DDL had also drifted from the real table. → [[DEBT Runtime DDL On Hot Path]]
7. **Get tests running, then one CI job.** Tests run (**487 across 46 files**); there is still no CI. Lint + tests + `db:status` would be the job. Note what a green run does *not* prove: the suite does not replace live deployment and database verification. → [[Roadmap]] · [[Things I Should Not Forget]]

## The credential rule

Privileged keys and auth signing/encryption keys carry no `NEXT_PUBLIC_` prefix, which is correct — that prefix is what Next uses to decide what ships to the browser. The live hazard is **importing a server module into a client component**, which would bundle whatever it reads. `src/services/` mixing server and client modules under one folder name is what makes that easy to do by accident. → [[DEBT Services Folder Mixes Two Concerns]]

## Related

[[Environment Setup]] · [[Important Commands]] · [[Things That Might Break]] · [[Roadmap]] · [[ADR-008 Manual Migration Procedure]]
