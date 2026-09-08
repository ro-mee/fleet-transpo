---
type: reference
title: mobile_refresh_tokens
tags: [database, table, auth, mobile]
source:
  - src/lib/mobile-auth.js
  - mobile/lib/api.js
  - src/app/api/mobile/auth/login/route.js
  - src/app/api/mobile/auth/refresh/route.js
  - src/lib/api/utils.js
last_verified: 2026-09-08
---

# Table: `mobile_refresh_tokens`

**313 families / hundreds of rows (one family alone reached 57)** — CONFIRMED 2026-09-08. The server side of the driver app's session.

## What's stored

**SHA-256 of the refresh token — never the token itself.** A database leak yields hashes: useless for authenticating, still usable for revocation. Same reasoning as password hashing; a 30-day refresh token is a long-lived credential too. → [[Token Rotation And Refresh Races]]

## The token pair — CONFIRMED

| | Lifetime | Stored here | Audience |
|---|---|---|---|
| Access | 15 min | no | API |
| Refresh | 30 days | yes, hashed | refresh only |

Different `aud` claims mean a refresh token presented to a normal API route **fails verification**. Without that split, a leaked refresh token would work as a 30-day bearer credential. → [[ADR-009 Separate Mobile Auth]]

Signed with `jose`, HS256. Entirely separate from the web session, which is NextAuth JWT via cookie. → [[Authentication]]

## Single-use and rotating

Each refresh consumes its token and issues a new one. Presenting a consumed token is a signal — either a replay, or the concurrency bug that `mobile/lib/api.js` single-flight exists to prevent:

> *"…the first would succeed and the other two would present an already-revoked token and log the driver out."*

**Families, not rows, are the session.** Rotation revokes the old row and inserts a new one *with the same `family_id`* (migration 087), so a live session's family accumulates rows: exactly one active, N revoked. The 2026-09-08 SESSION_REVOKED storm came from a family-liveness check that sampled an arbitrary row (`LIMIT 1`, no `ORDER BY` or active-row filter) instead of asking "does this family still have an active row?" — once a family rotated, PostgreSQL could return a revoked row and the live session read as revoked. → [[Token Rotation And Refresh Races]]

## Why the row count only grows — CONFIRMED

Because rotation appends. Every refresh over the app's lifetime leaves a row; login opportunistically prunes rows expired >30 days or revoked >30 days (`login/route.js` cleanup), but nothing else prunes.

**UNKNOWN:** whether any further cleanup job is warranted. Login-time opportunistic pruning now bounds the table by login activity. The table only grows between logins, and every consumed row is dead weight that still contains a (hashed) credential. → [[Open Questions]] · [[Roadmap]]

## What to check here when a driver reports being logged out

1. Is there a burst of rows with near-identical timestamps? → concurrent refresh, single-flight not working (or the GPS background context — separate JS context, own single-flight; the rotation cooldown exists for this)
2. Is the family's newest **active** row older than 30 days? → legitimate expiry
3. Does the family still have an active row at all? → revoked (replay, logout, admin revoke, account lifecycle)
4. Are there rows for a driver who never logged in? → investigate

## Related

[[Mobile Architecture]] · [[Authentication]] · [[Token Rotation And Refresh Races]] · [[ADR-009 Separate Mobile Auth]] · [[employees]] · [[Database Overview]] · [[ERD]]
