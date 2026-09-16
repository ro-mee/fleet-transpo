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
5. **Oversized Base64 Avatar URL in JWT Cookies (HTTP 431 & HTTP 494)**:
   In `src/lib/auth.js`, `user.avatarUrl` was populated from `employees.avatar_url` or `drivers.license_image_url`. In the database, an employee record (`crypticalromes@gmail.com`) had a 57.5 KB base64 `data:image/jpeg;base64,...` string stored in `avatar_url`. NextAuth serialized this entire 57.5 KB string into the JWT session cookie, chunking it across 15+ cookies (`next-auth.session-token.0..15`) totaling >60 KB. Every subsequent request sent a massive `Cookie` header that blew past:
   - Node.js local dev server's 16 KB max header limit: **`HTTP ERROR 431: Request Header Fields Too Large`**
   - Vercel's edge proxy header limit: **`494 REQUEST_HEADER_TOO_LARGE`**
   Because 431/494 errors abort the HTTP request before Next.js can handle it, login attempts and page loads failed completely.
6. **Driver Login Web Redirection to `/dashboard`**:
   `getAndClearReturnTo` in `src/lib/auth/return-to.js` restored any cached `sessionStorage` path without verifying role access. If a user previously navigated to `/` or `/dashboard` (which saved `/dashboard`), logging in as a driver redirected them to `/dashboard` where `NAV_ROLES["/dashboard"]` denies drivers with an "Access restricted" error.

## Resolution

1. **Avatar URL Sanitization (`src/lib/auth.js`)**:
   - Added `isSafeAvatarUrl(url)` requiring remote HTTP/HTTPS URLs ≤ 512 characters, exported at module scope so it is accessible to both `authorize` and `callbacks.jwt` (resolving `ReferenceError: isSafeAvatarUrl is not defined` which was causing HTTP 500 crashes during NextAuth credential login).
   - Strictly rejected `data:` base64 strings and oversized payloads from `user.avatarUrl` and `token.avatarUrl`, keeping JWT cookies under ~1 KB.
   - Removed `license_image_url` from avatar fallback.
   - Cleaned the raw base64 data URLs from `employees.avatar_url` in PostgreSQL.
2. **Role-Scoped Web Redirection (`src/lib/auth/return-to.js`)**:
   - Enforced that `role === "driver"` always routes to `/driver` (or `/driver/*`), overriding foreign `/dashboard` paths.
   - Blocked non-drivers from being redirected to `/driver`.
3. **Driver Management API Guarding (`src/app/api/drivers/route.js`, `src/app/api/drivers/[id]/route.js`)**:
   - Guarded `avatar_url` so uploaded license scans are not assigned to `employees.avatar_url` unless they are valid remote URLs.
4. **Same-Origin & Deployment Awareness in `src/proxy.js`**:
   - `isAllowedOrigin(origin, request)` dynamically allows same-origin requests by validating against `request.nextUrl.origin`, `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
   - Added support for `NEXTAUTH_URL` and `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL`.
   - Never return `null` body on API 403s; return structured JSON `{ error: "Forbidden: origin not allowed" }`.
5. **Graceful Error Translation in `src/services/auth.service.js`**:
   - Caught `SyntaxError` / `Unexpected end of JSON input` from `nextAuthSignIn` and surfaced a clean, actionable message: `"Authentication service returned an unexpected response. Please check your network and server configuration."`.
6. **Scope and Safe-Text Interceptor in `src/context/session-manager.jsx`**:
   - Scoped `isAppApiRequest` to ignore all `/api/auth/` routes except `/api/auth/profile`.
   - Changed cloned 401 handling to use `cloned.text()` with a safe `JSON.parse` wrapper to prevent empty-body parse crashes.
7. **Safe Status Polling in `src/app/(auth)/login/page.js`**:
   - Checked `res.ok` before parsing `/api/auth/login-status` and appended `.catch(() => ({}))`.
8. **Verification**:
   - `src/lib/auth.test.js` (5/5 passed).
   - `src/services/auth.service.test.js` (3/3 passed).
   - `src/lib/auth/return-to.test.js` (8/8 passed).
   - `src/security-boundaries.test.js` (10/10 passed).
   - Full Vitest suite passing (137 test files, 1319 tests).
   - `npm run verify:auth` passing (261/261 routes guarded).
