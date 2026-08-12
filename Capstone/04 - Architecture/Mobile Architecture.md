---
type: architecture
title: Mobile Architecture
tags: [architecture, mobile, expo]
source:
  - mobile/app/(app)/(tabs)/_layout.js
  - mobile/lib/api.js
  - mobile/lib/tracking.js
  - mobile/lib/rbac.js
  - mobile/AGENTS.md
last_verified: 2026-08-11
---

# Mobile Architecture

Expo SDK ~54, expo-router ~6. **Drivers only.** A separate app with a separate auth system, not a wrapper around the web dashboard.

## Navigation — CONFIRMED (`mobile/app/(app)/(tabs)/_layout.js`)

| Route | Label |
|---|---|
| `index` | Home |
| `trips` | Trips |
| `vehicle` | Vehicle |
| `notifications` | Alerts |
| `profile` | Profile |

Three separate documents describe these tabs differently, all wrong. → [[DOC Mobile Tabs Documented Three Ways]]

## The API client is the most carefully-written file in the mobile app — CONFIRMED

`mobile/lib/api.js`: `TIMEOUT_MS = 15000`, `MAX_RETRIES = 1`, and a **single-flight refresh promise**. From its docstring:

> *"Without this, a screen firing three requests at once on a stale token would run three refreshes; because refresh is single-use and rotating, the first would succeed and the other two would present an already-revoked token and log the driver out."*

That is a precise description of a real race. The fix — one shared in-flight refresh promise that all callers await — is the standard solution, and the comment explains *why* it's needed rather than just what it does.

→ [[Token Rotation And Refresh Races]]

```mermaid
sequenceDiagram
    participant S1 as Screen A
    participant S2 as Screen B
    participant C as api.js
    participant API as /api/mobile/auth/refresh
    S1->>C: request (401)
    S2->>C: request (401)
    C->>C: refreshPromise ??= doRefresh()
    C->>API: ONE refresh call
    API-->>C: new access + new refresh (old revoked)
    C-->>S1: retry with new token
    C-->>S2: retry with new token
```

## GPS tracking — CONFIRMED (`mobile/lib/tracking.js`)

- `watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })` writes to a ref
- A separate interval POSTs the latest fix every **30 s** to `/api/mobile/driver/trips/${tripId}/gps`

**Decoupling the sensor from the upload is the right shape**: position updates arrive at whatever rate the GPS produces them, but network traffic is bounded at one request per 30 s.

**Foreground only**, and the code says why:

> *"background updates need a dev build plus Play Store review, so that is deliberately out of scope for this MVP."*

An honest, well-documented scope limit. It does mean tracking stops when the driver backgrounds the app — a real operational gap to know about, not a bug. → [[Tracking]]

## Client-side role decoding — CONFIRMED (`mobile/lib/rbac.js`)

`decodeJwtRole()` base64url-decodes the JWT payload **without verifying the signature**. The docstring is explicit:

> *"signature verification stays server-side, so this is for reading claims, not trusting them."*

This is correct practice, correctly documented: the client decodes to decide what to *render*; the server verifies to decide what to *allow*. A forged local token changes the UI and nothing else. → [[Client Side Role Decoding Is Not Security]]

## Auth

Separate from web — 15-minute access tokens, 30-day single-use rotating refresh tokens hashed in `mobile_refresh_tokens`, audience-split. Full detail in [[Authentication]].

## Version warning — CONFIRMED

`mobile/AGENTS.md`: *"Expo HAS CHANGED — read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code."*

Same trap as [[Framework Version Drift]] on the web side.

## Related

[[Authentication]] · [[Tracking]] · [[Token Rotation And Refresh Races]] · [[Trips]] · [[Architecture]] · [[Driver Management]]
