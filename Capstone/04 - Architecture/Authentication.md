---
type: architecture
title: Authentication
tags: [architecture, auth, security]
source:
  - src/lib/auth.js
  - src/lib/api/utils.js
  - src/lib/mobile-auth.js
  - src/proxy.js
last_verified: 2026-08-11
---

# Authentication

**Two independent auth systems**, by design. Web uses NextAuth cookies; mobile uses bearer JWTs. They share only the `employees` credential store.

## Web: NextAuth v4 — CONFIRMED

Credentials provider, **JWT session strategy** (not database sessions), `bcryptjs` compare against `employees.password_hash`.

```mermaid
sequenceDiagram
    participant U as Browser
    participant NA as NextAuth /api/auth
    participant DB as employees
    U->>NA: POST credentials
    NA->>DB: SELECT ... WHERE email = $1 AND deleted_at IS NULL
    DB-->>NA: password_hash, role_id
    NA->>NA: bcrypt.compare
    NA-->>U: Set-Cookie (signed JWT, role in claims)
```

Role lands in the JWT claims, so authorization needs no per-request DB lookup.

## Mobile: separate bearer JWT — CONFIRMED

`jose`, HS256. Two token types with **different audiences**:

| Token | Lifetime | Storage |
|---|---|---|
| Access | 15 minutes | memory / expo-secure-store |
| Refresh | 30 days, **single-use rotating** | SHA-256 **hashed** in `mobile_refresh_tokens` (57 rows) |

Three properties worth naming:

1. **Refresh tokens are hashed at rest.** A DB read doesn't yield usable tokens.
2. **Single-use rotation.** Presenting a refresh token invalidates it and issues a new one — replay is detectable.
3. **The audience split is the actual security control.** A refresh token cannot be presented as an access token, because audience is verified. Without that, a 30-day token would be a 30-day API key.

→ [[Token Rotation And Refresh Races]]

## The gate: `requireAuth()` — CONFIRMED

Everything hangs off `src/lib/api/utils.js`:

```js
const DEFAULT_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management"];

resolveIdentity(req)   // Bearer token WINS over cookie session
requireAuth(req, allowedRoles = DEFAULT_ROLES)
requireDriver(req)     // requireAuth(req, ["driver"]) + guarantees driverId
```

**`driver` is deliberately absent from `DEFAULT_ROLES`.** Any route that forgets to pass explicit roles therefore **fails closed for drivers** — the most likely-to-be-abused role is excluded by default. That is a genuinely good default. → [[Fail Closed By Default]]

`resolveIdentity` preferring Bearer over cookie matters when both are present (e.g. a driver's browser session plus a mobile token) — the explicit credential wins.

## Where auth is NOT — CONFIRMED

| Place you'd look | Reality |
|---|---|
| `src/middleware.js` | **Doesn't exist.** Next 16 renamed it. → [[DOC SYSTEM.md References middleware.js]] |
| `src/proxy.js` | CORS preflight only. **No auth.** |
| `proxy.js` (root) | Dead file implying Supabase Auth. → [[BUG Root proxy.js Is Dead Code]] |
| RLS policies | 69 of them, all inert. → [[Why RLS Is Not A Boundary]] |

**Every one of the 113 route handlers calls `requireAuth()` itself.** There is no central chokepoint. That is the single most important fact about this system's security posture: the guarantee is *per-route discipline*, and a route that forgets is unprotected with nothing to catch it.

**TODO:** an audit that asserts every `src/app/api/**/route.js` contains a `requireAuth`/`requireDriver` call. Cheap to write, high value.

## Related

[[RBAC]] · [[employees]] · [[Mobile Architecture]] · [[Why RLS Is Not A Boundary]] · [[Architecture]] · [[Backend]]
