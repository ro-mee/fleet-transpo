---
type: bug
status: fixed
severity: sev-2
fixed_on: 2026-09-20
tags: [bug, auth, next-auth, dependencies, fixed]
source:
  - src/app/api/auth/[...nextauth]/route.js
  - src/lib/email/smtp.js
  - src/app/api/auth/forgot-password/route.js
last_verified: 2026-09-20
---

# Bug: NextAuth Client Fetch Error on Session Fetch (HTML Response)

> **STATUS: FIXED 2026-09-20** — Installed missing `nodemailer` dependency in `node_modules` and restarted dev server.

## Symptom

Console error triggered by NextAuth client in the browser or terminal:
```
[next-auth][error][CLIENT_FETCH_ERROR] "https://next-auth.js.org/errors#client_fetch_error" "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" {}
```

## Root Cause

Following the merge of commit `e8503c9` (which swapped Resend for Nodemailer SMTP), `package.json` was updated to include `"nodemailer": "^7.0.13"`. However, `npm install` had not been executed locally after the merge.

When the Next.js dev server started, any request hitting `/api/auth/*` (such as NextAuth client background queries to `/api/auth/session`, `/api/auth/csrf`, or `/api/auth/providers`) triggered Next.js compilation of the auth route group. Turbopack failed compilation on `src/lib/email/smtp.js` with:
```
Module not found: Can't resolve 'nodemailer'
```
Because of this compilation error, Next.js served a 500 error page formatted as HTML (`<!DOCTYPE html>...`). NextAuth client's internal fetch handler attempted to parse the HTML string as JSON, raising `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

## Resolution

1. Executed `npm install` to install `nodemailer` and prune unreferenced dependencies.
2. Verified full production build compiles cleanly (`npm run build`).
3. Terminated the stale Next.js dev server process holding cached module resolution errors and booted a fresh dev server.
4. Verified that `/api/auth/session`, `/api/auth/csrf`, `/api/auth/providers`, `/api/auth/login-status`, and `POST /api/auth/forgot-password` all respond with HTTP 200 and valid JSON payloads.
