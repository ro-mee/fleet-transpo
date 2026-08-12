---
type: reference
title: Technology Stack
tags: [stack, dependencies]
source:
  - package.json
  - mobile/package.json
  - next.config.mjs
last_verified: 2026-08-11
---

# Technology Stack

All CONFIRMED from `package.json` unless noted.

## Web

| Concern | Choice | Version | Note |
|---|---|---|---|
| Framework | Next.js | 16.2.11 | App Router; `middleware.js` → `proxy.js` |
| UI | React | 19.2.4 | pinned exactly, with `overrides` |
| Auth | next-auth | ^4.24.15 | Credentials + JWT strategy |
| DB client | @supabase/supabase-js | ^2.110.8 | service-role only |
| DB driver | pg | ^8.22.0 | raw Pool, used alongside Supabase |
| Hashing | bcryptjs | ^3.0.3 | |
| JWT | jose | ^4.15.9 | mobile tokens |
| Server state | @tanstack/react-query | ^5.101.4 | |
| Tables | @tanstack/react-table | ^8.21.3 | |
| Forms | react-hook-form + @hookform/resolvers | ^7.82 / ^5.4 | |
| Validation | zod | ^4.4.3 | also the integration contract |
| Client state | zustand | ^5.0.14 | |
| UI primitives | Radix UI (17 packages) | | shadcn-style |
| Styling | tailwindcss | ^4 | **CSS-first — no `tailwind.config.js`** |
| Charts | recharts | ^3.10.0 | |
| Maps | leaflet + react-leaflet | ^1.9.4 / ^5.0.0 | |
| Routing/geo | TomTom API | | `src/lib/tomtom.js` |
| OCR | tesseract.js | ^7.0.0 | driver licenses |
| Animation | framer-motion | ^12.42.2 | |
| Dates | date-fns | ^4.4.0 | |
| Testing | vitest | ^3.2.7 | ✅ installed — 16 files, 197 tests passing |

## Mobile — CONFIRMED (`mobile/package.json`, `mobile/AGENTS.md`)

| Concern | Choice |
|---|---|
| Platform | Expo SDK ~54 |
| Routing | expo-router ~6 (file-based) |
| Secure storage | expo-secure-store |
| Location | expo-location (foreground only) |
| Icons | @expo/vector-icons |

`mobile/AGENTS.md`: *"Expo HAS CHANGED — read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code."*

## External services

| Service | Used for | Status |
|---|---|---|
| Supabase | Postgres, storage, realtime | **Live** — project `dnxuphhxlzidvwtdqqkq` |
| TomTom | routing / distance | Key present in `.env` |
| OpenAI-compatible LLM | optional narration | **No key in `.env`** — always falls back |
| Booking/PMS gateway | request source | **Mock only** — `HttpBookingGateway` throws |

## Notable configuration — CONFIRMED

`next.config.mjs` sets `turbopack.root` and a `headers()` CORS rule for `/api/:path*` with `Access-Control-Allow-Origin: *`.

> **Note — INFERRED.** CORS is configured in **two places**: `next.config.mjs` headers *and* `src/proxy.js`. Wildcard origin is permissive; acceptable for a LAN-tested mobile app, worth revisiting before any real deployment.

There is also a cache-busting comment: `// Invalidate Turbopack cache: 2026-08-07T14:30:45`. INFERRED: someone hit a stale-cache bug and worked around it this way.

## Related

[[Architecture]] · [[Environment Setup]] · [[Quick Reference]] · [[Framework Version Drift]]
