---
type: reference
title: Environment Setup
tags: [development, environment, setup]
source:
  - .env
  - package.json
  - mobile/package.json
last_verified: 2026-09-02
---

# Environment Setup

## What's in `.env` — CONFIRMED (11 keys, all well-formed)

| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (largely unused — see [[Supabase]]) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Privileged.** Used by `getAdminClient()` |
| `NEXT_PUBLIC_APP_URL` | Base URL |
| `AUTH_SECRET` | NextAuth |
| `NEXTAUTH_SECRET` | NextAuth |
| `NEXTAUTH_URL` | NextAuth |
| `MOBILE_JWT_SECRET` | **Required in production.** Dedicated mobile bearer-token signing key; development/test may fall back to `NEXTAUTH_SECRET` with a warning |
| `MFA_ENCRYPTION_KEY` | **Required for MFA enrollment.** Dedicated 32-byte hex/base64 AES-256-GCM key for TOTP secrets; never expose it to the client |
| `DATABASE_URL` | **Privileged.** Direct `pg` connection, DB owner |
| `NEXT_PUBLIC_TOMTOM_API_KEY` | Maps, client side |
| `TOMTOM_API_KEY` | Maps, server side |

> ⚠ **Line 1 carries a UTF-8 BOM.** INFERRED: this is the likely real cause of the `supabase` CLI parse failure that `AGENTS.md` misattributes to "line 8 being an orphaned token." → [[ADR-008 Manual Migration Procedure]]

## What's missing — CONFIRMED

| Key | Consequence of absence |
|---|---|
| `CRON_SECRET` | Scheduled/cron endpoints are unauthenticated or non-functional. **TODO:** find which routes read it. |
| `BOOKING_WEBHOOK_SECRET` | The inbound webhook can't verify it's really Booking calling |
| `BOOKING_GATEWAY` | Without `=http`, the gateway is the **mock**. Nothing reaches Booking. → [[System Boundaries]] |
| Any LLM key | Narration is always `null`. Deterministic scores still work. → [[AI Advisory]] |

**None of these break the app today** — every one degrades to a documented fallback. But three of the four are needed before the Booking integration is real.

## Two credentials, both total access

`SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` each grant full database access, bypassing RLS. → [[ADR-004 Dual Database Access]] · [[Why RLS Is Not A Boundary]]

Never let either reach a client bundle. The `NEXT_PUBLIC_` prefix is what Next uses to decide what ships to the browser — note that neither privileged key has it, which is correct. The hazard is importing a server module into a client component. → [[DEBT Services Folder Mixes Two Concerns]]

## Running it

```bash
npm install
npm run dev          # web, next dev
cd mobile && npx expo start
```

Tests: Vitest is installed; `npm run test:run -- --configLoader runner` passes **473/473 tests across 42 files**. The default config loader still hits a local Windows/esbuild permission error. → [[Testing]]

## What you cannot do here — CONFIRMED

`supabase` CLI, `psql`, and `docker` are all unavailable. Migrations go through the `pg`-script procedure in [[Quick Reference]].

## Related

[[Quick Reference]] · [[Technology Stack]] · [[Supabase]] · [[ADR-008 Manual Migration Procedure]] · [[Current State]]
