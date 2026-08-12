---
type: reference
title: mobile_refresh_tokens
tags: [database, table, auth, mobile]
source:
  - src/lib/mobile-auth.js
  - mobile/lib/api.js
last_verified: 2026-08-11
---

# Table: `mobile_refresh_tokens`

**57 rows** — CONFIRMED. The server side of the driver app's session.

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

## Why 57 rows for 23 drivers — CONFIRMED

Because rotation appends. Every refresh over the app's lifetime leaves a row; nothing prunes them.

**UNKNOWN:** whether any cleanup job exists. Nothing in the repo suggests one. The table only grows, and every consumed row is dead weight that still contains a (hashed) credential. A periodic delete of expired and consumed rows is the obvious fix. → [[Open Questions]] · [[Roadmap]]

## What to check here when a driver reports being logged out

1. Is there a burst of rows with near-identical timestamps? → concurrent refresh, single-flight not working
2. Is the newest row older than 30 days? → legitimate expiry
3. Are there rows for a driver who never logged in? → investigate

## Related

[[Mobile Architecture]] · [[Authentication]] · [[Token Rotation And Refresh Races]] · [[ADR-009 Separate Mobile Auth]] · [[employees]] · [[Database Overview]] · [[ERD]]
