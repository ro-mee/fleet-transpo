---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, auth, mobile]
source:
  - src/lib/mobile-auth.js
  - src/lib/api/utils.js
  - mobile/lib/api.js
last_verified: 2026-08-11
---

# ADR-009: Separate Mobile Auth

## Context

The web dashboard uses NextAuth v4 with a cookie-based JWT session. The Expo app also needs authentication. Reusing the web session would mean cookie handling in a native app.

## Decision — CONFIRMED as fact, mechanism documented, choice not

A **second, independent** token system for mobile — `jose`, HS256:

| | Web | Mobile |
|---|---|---|
| Credential | NextAuth session cookie | Bearer JWT |
| Access lifetime | session | **15 minutes** |
| Refresh | NextAuth handles | **30-day, single-use, rotating** |
| Storage | httpOnly cookie | `expo-secure-store` |
| Server state | none | `mobile_refresh_tokens` (57 rows), **SHA-256 hashed** |

Both resolve to the same [[employees]] row. `resolveIdentity()` in `src/lib/api/utils.js` accepts either, with **Bearer winning over cookie**.

**The reason for two systems rather than one is not documented.** INFERRED: cookie-based sessions are awkward in React Native, and 15-minute access tokens with rotation is the standard mobile pattern.

## The three properties that make it sound — CONFIRMED

1. **Refresh tokens hashed at rest.** Reading `mobile_refresh_tokens` yields hashes, not usable tokens.
2. **Single-use rotation.** Using a refresh token invalidates it. Replay is detectable — a second use of the same token means it leaked.
3. **Audience split is the real control.** Access and refresh tokens carry different `aud` claims, and audience is verified. A refresh token cannot be presented as an access token. Without that, a 30-day refresh token would effectively be a 30-day API key — the short access lifetime would buy nothing.

Point 3 is the one people miss. → [[Token Rotation And Refresh Races]]

## The consequence the client had to handle — CONFIRMED

Single-use rotation creates a race. From `mobile/lib/api.js`:

> *"Without this, a screen firing three requests at once on a stale token would run three refreshes; because refresh is single-use and rotating, the first would succeed and the other two would present an already-revoked token and log the driver out."*

Solved with a **single-flight refresh promise**. Note the shape of this: a good security decision (rotation) created a client-side concurrency problem that had to be solved separately. That's normal, and worth internalising — security properties have engineering consequences.

## Consequences

**Good:**
- Short access-token window limits damage from a stolen token
- Rotation makes theft detectable
- Native-appropriate storage via `expo-secure-store`
- Web and mobile auth can evolve independently

**Costs:**
- **Two auth systems to maintain and reason about.** A change to role handling must be made twice.
- `resolveIdentity` preferring Bearer over cookie is a subtle precedence rule
- Server-side refresh token state (57 rows) needs pruning — **TODO:** is there a cleanup job for expired tokens?
- Every mobile client must implement single-flight refresh correctly

## Revisit if

- A third client appears — that's the point to extract one shared token service
- Refresh token table growth becomes a problem

## Related

[[Authentication]] · [[Mobile Architecture]] · [[Token Rotation And Refresh Races]] · [[employees]] · [[Decision Log]]
