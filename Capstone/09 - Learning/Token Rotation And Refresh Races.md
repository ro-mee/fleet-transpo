---
type: learning
tags: [learning, security, auth, mobile]
source:
  - mobile/lib/api.js
  - src/lib/mobile-auth.js
last_verified: 2026-08-11
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

## Related concepts

[[Mobile Architecture]] · [[Authentication]] · [[Defence In Depth]] · [[Client Side Role Decoding Is Not Security]] · [[ADR-009 Separate Mobile Auth]] · [[Learning Dashboard]]
