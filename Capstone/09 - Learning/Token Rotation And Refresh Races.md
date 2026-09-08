---
type: learning
tags: [learning, security, auth, mobile]
source:
  - mobile/lib/api.js
  - src/lib/mobile-auth.js
last_verified: 2026-09-08
---

# Concept: Token Rotation And Refresh Races

## What it is

**Rotation** — each use of a refresh token invalidates it and issues a new one. Stolen tokens then have a short useful life, and a replay is detectable: if a revoked token is presented, someone has a copy they shouldn't.

**The cost:** single-use makes refresh a critical section. Two concurrent refreshes with the same token means one succeeds and the other presents a token that was just revoked.

## Why it matters

The failure isn't theoretical — it's the default on a mobile home screen. Three widgets mount, three requests fire, all with the same expired token, all get 401, all refresh.

## How it appears in my project — CONFIRMED

Access 15 min, refresh 30 days, single-use rotating, SHA-256 hashed in `mobile_refresh_tokens`. `mobile/lib/api.js` implements **single-flight**: the first 401 starts a refresh and stores the promise; concurrent 401s await that same promise rather than starting their own.

The docstring states the failure it prevents:

> *"Without this, a screen firing three requests at once on a stale token would run three refreshes; because refresh is single-use and rotating, the first would succeed and the other two would present an already-revoked token and log the driver out."*

Note **what** the bug is: not a security hole — a **usability** one. Drivers randomly logged out mid-shift, unreproducible, blamed on the network.

## The second defence: audience split

Access and refresh tokens carry different `aud` claims. A refresh token presented to a normal API route fails verification. Without that, a leaked refresh token would work as a bearer credential for 30 days. → [[ADR-009 Separate Mobile Auth]]

## Why hash the stored token

`mobile_refresh_tokens` stores SHA-256 of the token, not the token. A database leak yields hashes — useless for authentication, still usable for revocation. Same reason passwords are hashed; refresh tokens are long-lived credentials too.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Rotating without single-flight | Random logouts under concurrency |
| Storing refresh tokens in plaintext | DB leak = full account takeover |
| Same audience for both tokens | Refresh token becomes a 30-day access token |
| Refresh in an interceptor without a queue | The retried request goes out with the old token |
| Never pruning revoked rows | Table grows forever → [[Open Questions]] |
| **Family-liveness check with `LIMIT 1` and no `ORDER BY`/filter** | **A valid family can be judged "revoked" once it rotates** (2026-09-08 storm, below) |

## The 2026-09-08 SESSION_REVOKED storm — CONFIRMED

A driver logged in and every screen immediately errored `401 SESSION_REVOKED "Session revoked."` while `POST /api/mobile/auth/refresh` kept returning 200 — the app churned 401↔refresh forever without logging out.

**Root cause:** `resolveCurrentIdentity`'s bearer-path family check (`src/lib/api/utils.js`) asked:

```sql
SELECT revoked_at, expires_at FROM mobile_refresh_tokens
WHERE employee_id = $1 AND family_id = $2 LIMIT 1   -- no ORDER BY, no revoked_at IS NULL
```

Rotation keeps the family alive by revoking the old row and inserting a new one, so **after rotation the family contains both a revoked and an active row**. Because the query had no `ORDER BY` and no active-row filter, PostgreSQL could return a revoked row and falsely classify the valid family as revoked. Login worked (fresh family = one active row); the poison appeared at the first 15-minute token refresh. Refresh itself stayed 200 because it looks up by `token_hash`, not the family check — hence the "server that revokes you and refreshes you at the same time" log signature. The `200 /api/notifications` in the same log was the web dashboard's cookie session, a different code path.

**Live-DB confirmation:** 313 families total; 9 in the mixed state (1 active + N revoked rows) — every one a live session the old check could misread. One family had **57 rows** from the GPS-context rotation churn (~30s cadence for 43 minutes) — the very churn the rotation cooldown was built to tame.

**Fix:** ask the invariant the refresh route already maintains — *a family is alive iff it still has an active, unrevoked descendant*:

```sql
SELECT expires_at FROM mobile_refresh_tokens
WHERE employee_id = $1 AND family_id = $2 AND revoked_at IS NULL
ORDER BY created_at DESC LIMIT 1
```

Zero rows → `SESSION_REVOKED`; active row past `expires_at` → `SESSION_EXPIRED`. Note that an all-revoked family and a never-existing family are **deliberately indistinguishable** here — both yield zero rows and take the same unrecoverable-session path; nothing downstream needs to tell them apart. Pinned by `src/lib/api/utils.family-check.test.js` (post-rotation shape resolves; all-zero-row and expired classifications; the SQL shape itself is asserted). Full suite 741 passing.

**Lesson:** a family is not a row. Any query about a family's state must account for the family being *multiple rows with differing fates* — filter to the living row, don't sample an arbitrary one. Same lesson class as the resolveDriverId camelCase bug: pin what the system actually writes, not what you imagine it holds.

## Related concepts

[[Mobile Architecture]] · [[Authentication]] · [[Defence In Depth]] · [[Client Side Role Decoding Is Not Security]] · [[ADR-009 Separate Mobile Auth]] · [[Learning Dashboard]]
