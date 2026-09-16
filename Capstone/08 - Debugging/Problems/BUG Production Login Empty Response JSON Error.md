---
type: bug
status: fixed
severity: sev-1
fixed_on: 2026-09-16
tags: [bug, auth, login, next-auth, cors, proxy, json, production, fixed]
source:
  - src/proxy.js
  - src/services/auth.service.js
  - src/context/session-manager.jsx
  - src/app/(auth)/login/page.js
last_verified: 2026-09-16
---

# Bug: Production Login Failure ("Unexpected end of JSON input")

> **STATUS: FIXED 2026-09-16** — Resolved 0-byte response handling across CORS proxy, NextAuth signIn caller, session-manager fetch interceptor, and login status checks.

## Symptom

When signing in on the production deployment, the browser failed with:
```
TypeError: Failed to execute 'json' on 'Response': Unexpected end of JSON input
```
This raw browser DOM exception was displayed directly in the login screen error banner.

## Root Causes

1. **CORS Proxy 0-Byte Empty Body Rejection (`src/proxy.js`)**:
   Under the W3C Fetch specification, browsers automatically send an `Origin` header on all `POST` requests, even when they are same-origin. In production (`NODE_ENV === "production"`), `src/proxy.js` strictly checked whether `origin === new URL(process.env.NEXT_PUBLIC_APP_URL).origin`. If `NEXT_PUBLIC_APP_URL` was unset, defaulted to localhost, or mismatched the client's current HTTPS origin (e.g. preview vs custom domain), `proxy` returned `new NextResponse(null, { status: 403 })` with an empty body (0 bytes). Calling `res.json()` on an empty body in NextAuth's `_signIn` caused an immediate `SyntaxError: Unexpected end of JSON input`.
2. **Unguarded NextAuth `res.json()` Client Execution**:
   In `node_modules/next-auth/react/index.js`, `signIn("credentials")` directly awaits `res.json()` on the response from `/api/auth/callback/credentials`. If the server, reverse proxy, or WAF returns a non-JSON body (e.g. 0-byte 403, 302, or 502), the error bubbles up unhandled.
3. **Session Manager 401 Contamination (`src/context/session-manager.jsx`)**:
   When credentials failed or were throttled, NextAuth returned 401. The session manager's `window.fetch` interceptor did not exclude `/api/auth/callback/credentials` and called `cloned.json()`, triggering unhandled JSON parse rejections whenever 401s had no body.
4. **Login Status Polling (`src/app/(auth)/login/page.js`)**:
   `/api/auth/login-status` was read with an unguarded `await res.json()` on error paths without verifying `res.ok`.

## Resolution

1. **Same-Origin & Deployment Awareness in `src/proxy.js`**:
   - `isAllowedOrigin(origin, request)` dynamically allows same-origin requests by validating against `request.nextUrl.origin`, `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
   - Added support for `NEXTAUTH_URL` and `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL`.
   - Never return `null` body on API 403s; return structured JSON `{ error: "Forbidden: origin not allowed" }`.
2. **Graceful Error Translation in `src/services/auth.service.js`**:
   - Caught `SyntaxError` / `Unexpected end of JSON input` from `nextAuthSignIn` and surfaced a clean, actionable message: `"Authentication service returned an unexpected response. Please check your network and server configuration."`.
3. **Scope and Safe-Text Interceptor in `src/context/session-manager.jsx`**:
   - Scoped `isAppApiRequest` to ignore all `/api/auth/` routes except `/api/auth/profile`.
   - Changed cloned 401 handling to use `cloned.text()` with a safe `JSON.parse` wrapper to prevent empty-body parse crashes.
4. **Safe Status Polling in `src/app/(auth)/login/page.js`**:
   - Checked `res.ok` before parsing `/api/auth/login-status` and appended `.catch(() => ({}))`.
5. **Verification**:
   - `src/services/auth.service.test.js` added and passing.
   - `src/security-boundaries.test.js` updated with same-origin and 403 JSON tests (10/10 passing).
   - Full Vitest test suite passing (105 test files, 1136 tests).
   - `npm run verify:auth` passing (261/261 routes guarded).
