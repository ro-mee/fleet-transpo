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

> **Expo Go + stale LAN IP (seen 2026-09-13, recurred 2026-09-16, recurred 2026-09-20).** `mobile/.env` holds a hardcoded
> `EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:3000`, but the PC's DHCP lease can
> change (e.g. `.5` → `.248`, then back `.248` → `.5` on 2026-09-16; `.200` →
> `.193` on Ethernet on 2026-09-20; `.193` → `.200` again on 2026-09-21 — the
> phone reached Metro (`:8081` Established from `192.168.0.192`, firewall fine)
> but every API call failed because `mobile/.env` still pointed at `.193`). Symptom is
> `Network request failed. Check your connection (status 0)` — at login
> (`POST /api/mobile/auth/login` never reaches the dev terminal) or as a cluster
> of `Could not load fuel requests` + `Could not load trip for map` WARNs. Every
> request fails transport-level while the dev server is healthy. Mobile `api.js`
> throws this exact string only when `fetch()` threw twice without an HTTP
> response, so it rules out 401/403/429/500 backend causes. Fix: compare
> `ipconfig` IPv4 against `mobile/.env`, update the URL, restart Expo with
> `npx expo start --clear` (Expo Go caches env), and confirm from the phone
> browser that `http://<IP>:3000/api/mobile/driver/ref` responds before
> debugging code. `mobile/.env` is gitignored — this fix is local-only.
> Diagnosis shortcut (2026-09-20): `Get-NetTCPConnection -LocalPort 3000`
> must show a `::` listener (dev is LAN-bound) and `Invoke-WebRequest
> http://<IP>:3000/api/mobile/driver/ref` must answer HTTP 401 — that pair
> proves the server side healthy and isolates the fault to the app's baked
> URL or the phone's network.
>
> Metro-side check (seen 2026-09-21): the same `Network request failed` on the
> phone at `192.168.0.200:8081` means the dev-client cannot reach Metro at all.
> Run `Get-NetTCPConnection -LocalPort 8081` — if it shows only `TimeWait` rows
> and no `Listen` row, Metro is simply not running (TimeWait = leftovers of a
> dead session). Fix: `cd mobile && npm start -- --dev-client --lan` (plus root
> `npm run dev` for the API), then confirm the phone is on the same WiFi/LAN
> (192.168.0.x) and `http://<IP>:8081` loads in the phone browser.

> **Local-only mobile iteration (2026-09-21).** Keep `mobile/.env` pointed at
> the computer's current LAN IP and use the root `npm run dev` API together
> with `cd mobile && npm start -- --dev-client --lan`. This is the active path for Map and
> tooltip fixes: it does not use the EAS preview/production URL and does not
> require an APK rebuild. A downloaded preview/production APK has its API URL
> baked into the bundle, so it cannot be switched to Metro at runtime.

Tests: Vitest is installed; `npm run test:run -- --configLoader runner` passes **487/487 tests across 46 files**. The default config loader still hits a local Windows/esbuild permission error. → [[Testing]]

## Mobile APK builds — CONFIRMED 2026-09-06

The mobile app is a standalone native client: it bundles `EXPO_PUBLIC_*` values at **build time** (EAS inlines them into the JS bundle) and talks to the deployed web backend at `https://fleet-transpo.vercel.app/api/mobile/*`, which shares the same Supabase DB as the web app. No server needs to run locally for a release APK.

- `mobile/eas.json` profiles:
  - `development` — dev client; **requires `expo start` on the dev machine**. An APK built from this profile only works while Metro is running; this is by design, not a bug.
  - `preview` / `production` — both now `distribution: internal` + `android.buildType: apk` with the production env block (`EXPO_PUBLIC_API_URL`, Supabase URL/anon key, demo flag, TomTom key, dispatcher phone). `production` was previously `{}` (empty), which produced an `.aab` with missing env — fixed 2026-09-06.
- Build command: `cd mobile && eas build -p android --profile production` (or `preview`).
- Backend prerequisite: `MOBILE_JWT_SECRET` must be set on Vercel and differ from `NEXTAUTH_SECRET` (see `src/lib/auth/mobile-token.js` — it throws in production otherwise, so mobile login fails closed against the deployed site).
- **Verified working end-to-end 2026-09-06** via `adb`: production APK (build from commit `83c3348`, 104,457,160 bytes — URL + `android.permission.INTERNET` confirmed by pulling and inspecting the installed binary) logs in against the deployed API. A "Network request failed" episode traced to a **stale older build on the test phone**, not a code or server problem — the dumpsys `firstInstallTime` proved a fresh install fixed it. When an APK shows network failures, verify *which build is actually installed* (`adb shell dumpsys package com.fleet.mobile`) before debugging code; `eas-cli build:list` + downloading the APK and grepping `assets/index.android.bundle` for the baked URL is the definitive check.

## What you cannot do here — CONFIRMED

`supabase` CLI, `psql`, and `docker` are all unavailable. Migrations go through the `pg`-script procedure in [[Quick Reference]].

## Related

[[Quick Reference]] · [[Technology Stack]] · [[Supabase]] · [[ADR-008 Manual Migration Procedure]] · [[Current State]]
