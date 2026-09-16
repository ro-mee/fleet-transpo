---
type: bug
status: fixed
severity: sev-2
fixed_on: 2026-09-16
tags: [bug, auth, cors, fetch, rsc, nextjs, fixed]
source:
  - src/proxy.js
  - src/context/session-manager.jsx
last_verified: 2026-09-16
---

# Bug: RSC Payload & NextAuth Client Fetch Error on Dashboard

> **STATUS: FIXED 2026-09-16** — Scoped `window.fetch` interceptor to app `/api/` calls and added local development loopback/LAN support to `src/proxy.js`.

## Symptom

Terminal/Browser logs showed unhandled rejections and failed RSC / auth session fetches:
```
[browser] ⨯ unhandledRejection: TypeError: Failed to fetch
[browser] Failed to fetch RSC payload for http://localhost:3000/dashboard. Falling back to browser navigation. TypeError: Failed to fetch
    at SessionManagerProvider.useEffect (file://.../src_10_c9_t._.js:2071:58)
    at createFetch (file://.../node_modules_next_dist_client_0r5nbpw._.js:8207:21)
    at async fetchServerResponse (...)
    at async fetchMissingDynamicData (...)
[browser] [next-auth][error][CLIENT_FETCH_ERROR] Failed to fetch /api/auth/session
```

## Root Causes

1. **Global `window.fetch` Interceptor Contamination**:
   In `src/context/session-manager.jsx`, `SessionManagerProvider` monkey-patched `window.fetch` globally to catch 401s. Every fetch in the application—including Next.js App Router dynamic data fetches (`createFetch` -> `fetchMissingDynamicData`), static assets, and NextAuth session calls—flowed through this wrapper. When in-flight fetches were aborted or timed out during dashboard compilation or route redirection, the stack trace directly exposed `SessionManagerProvider.useEffect`.
2. **Dev Server Origin Mismatch in `src/proxy.js`**:
   `src/proxy.js` strictly compared `Origin` headers against `NEXT_PUBLIC_APP_URL` (`http://localhost:3000`). If a developer accessed via `127.0.0.1:3000`, IPv6 `[::1]:3000`, or a LAN IP (`192.168.*`), the proxy returned `403 Forbidden` without CORS headers. In modern browsers, CORS preflight rejections manifest in client JavaScript as `TypeError: Failed to fetch`.
3. **Turbopack Dev Cold-Start Compilation Latency**:
   Initial compilation of `/dashboard` and its dependency graph (charts, maps, role configurations) took >2 minutes, during which client fetches hung or were aborted upon tab navigation/refresh.

## Resolution

1. **Scope `window.fetch` Interceptor**:
   In `src/context/session-manager.jsx`, added `isAppApiRequest()` to only inspect `/api/` calls (ignoring Next.js internal RSC requests `/_next/`, page navigations, and NextAuth initialization checks). Bound execution context with `this || window` and guarded against duplicate wrapping with `window.__fleetops_fetch_intercepted`.
2. **Support Development Origins in `src/proxy.js`**:
3. **NextAuth Catch-All Route Export**:
   Standardized `src/app/api/auth/[...nextauth]/route.js` to `export const GET = handler; export const POST = handler;`, matching NextAuth v4's native expectation and resolving 404s on `/api/auth/session`.
4. **Verification**:
   `src/security-boundaries.test.js` updated and 10/10 tests passing; `npm run verify:auth` passing 261/261. All local endpoints (`/dashboard`, `/api/auth/session`, `/login`) return 200.
