---
type: reference
title: Environment Setup
tags: [development, environment, setup]
source:
  - .env
  - package.json
  - mobile/package.json
last_verified: 2026-09-03
---

# Environment Setup

## What's in `.env` — CONFIRMED (12 keys, values not reproduced)

| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (largely unused — see [[Supabase]]) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Privileged.** Used by `getAdminClient()` |
| `DATABASE_URL` | **Privileged.** Direct `pg` connection, DB owner |
| `NEXT_PUBLIC_APP_URL` | Base URL and browser CORS origin |
| `AUTH_SECRET` | Legacy auth compatibility |
| `NEXTAUTH_SECRET` | NextAuth and development fallback for mobile/MFA secrets |
| `NEXTAUTH_URL` | NextAuth URL |
| `GEMINI_API_KEY` | Gemini document/gauge scanning and optional AI output |
| `GEMINI_RECEIPT_MODEL` | Requested Gemini model for receipt/gauge scans |
| `NEXT_PUBLIC_TOMTOM_API_KEY` | Maps, client side |
| `TOMTOM_API_KEY` | Maps, server side |

> ⚠ **Line 1 carries a UTF-8 BOM.** INFERRED: this is the likely real cause of the `supabase` CLI parse failure that `AGENTS.md` misattributes to "line 8 being an orphaned token." → [[ADR-008 Manual Migration Procedure]]

## What's missing — CONFIRMED

| Key | Consequence of absence |
|---|---|
| `MOBILE_JWT_SECRET` | **Required in production.** Mobile token signing fails closed; development/test may fall back to `NEXTAUTH_SECRET` with a warning. It must differ from `NEXTAUTH_SECRET` in production. **CONFIRMED 2026-09-06: its absence on Vercel was the cause of the mobile APK login returning 500 "Internal server error"** — credentials validated, then `getSigningKey()` threw (`src/lib/auth/mobile-token.js:35`). **RESOLVED same day:** secret generated, set as Production env var on Vercel, redeployed; live login + `/api/mobile/driver/ref` verified returning 200 with tokens. No APK rebuild needed — the fix is server-side only. Note: immediately after redeploy, one authenticated call can still 401 from a stale pre-redeploy instance; it clears within a minute. |
| `MFA_ENCRYPTION_KEY` | **Required in production for MFA.** MFA setup/verification fails closed without a dedicated 32-byte hex/base64 AES-256-GCM key. Generate once and keep it stable after enrollment. |
| `CRON_SECRET` | Protected cron endpoints reject requests when the secret is unset. |
| `BOOKING_WEBHOOK_SECRET` | The inbound webhook rejects requests because it cannot verify Booking. |
| `BOOKING_GATEWAY` | Without `=http`, the gateway remains the **mock**. Nothing reaches Booking. → [[System Boundaries]] |
| `OPENAI_API_KEY` | OpenAI is optional; Gemini scans remain available when configured, and deterministic scores still work. → [[AI Advisory]] |

`MOBILE_JWT_SECRET` and `MFA_ENCRYPTION_KEY` must be added to the production hosting environment, not exposed through a `NEXT_PUBLIC_` variable. Vercel deployments need both values configured for the relevant environment and must be redeployed after adding them.

## Two credentials, both total access

`SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` each grant full database access, bypassing RLS. → [[ADR-004 Dual Database Access]] · [[Why RLS Is Not A Boundary]]

Never let either reach a client bundle. The `NEXT_PUBLIC_` prefix is what Next uses to decide what ships to the browser — note that neither privileged key has it, which is correct. The hazard is importing a server module into a client component. → [[DEBT Services Folder Mixes Two Concerns]]

## Running it

```bash
npm install
npm run dev          # web, next dev
cd mobile && npx expo start
```

Tests: Vitest is installed; `npm run test:run -- --configLoader runner` passes **487/487 tests across 46 files**. The default config loader still hits a local Windows/esbuild permission error. → [[Testing]]

## Mobile APK builds — CONFIRMED 2026-09-06

The mobile app is a standalone native client: it bundles `EXPO_PUBLIC_*` values at **build time** (EAS inlines them into the JS bundle) and talks to the deployed web backend at `https://fleet-transpo.vercel.app/api/mobile/*`, which shares the same Supabase DB as the web app. No server needs to run locally for a release APK.

- `mobile/eas.json` profiles:
  - `development` — dev client; **requires `expo start` on the dev machine**. An APK built from this profile only works while Metro is running; this is by design, not a bug.
  - `preview` / `production` — both now `distribution: internal` + `android.buildType: apk` with the production env block (`EXPO_PUBLIC_API_URL`, Supabase URL/anon key, demo flag, TomTom key, dispatcher phone). `production` was previously `{}` (empty), which produced an `.aab` with missing env — fixed 2026-09-06.
- Build command: `cd mobile && eas build -p android --profile production` (or `preview`).
- Backend prerequisite: `MOBILE_JWT_SECRET` must be set on Vercel and differ from `NEXTAUTH_SECRET` (see `src/lib/auth/mobile-token.js` — it throws in production otherwise, so mobile login fails closed against the deployed site).

## What you cannot do here — CONFIRMED

`supabase` CLI, `psql`, and `docker` are all unavailable. Migrations go through the `pg`-script procedure in [[Quick Reference]].

## Related

[[Quick Reference]] · [[Technology Stack]] · [[Supabase]] · [[ADR-008 Manual Migration Procedure]] · [[Current State]]
