---
type: debt
status: resolved
severity: sev-3
tags: [debt, docs, nextjs]
source:
  - SYSTEM.md
  - src/proxy.js
last_verified: 2026-08-26
---

# Doc Rot: SYSTEM.md References middleware.js

## The problem — CONFIRMED

`SYSTEM.md` referenced `src/middleware.js`. **The file does not exist.**

Next 16 renamed middleware → **`src/proxy.js`** (exporting `proxy()`), which is where CORS lives. The auth flow is not in any proxy at all — it's per-route `requireAuth()`. See [[Authentication]].

## Why it's dangerous

Exactly the trap `AGENTS.md` warns about: *"This is NOT the Next.js you know."* A reader who checks `SYSTEM.md` for "where is auth wired" is sent to a nonexistent file; the real answer (`src/lib/api/utils.js` per-route) is never found. If they search for `middleware.js`, they conclude auth is missing and may "fix" it by adding a Next-15-style middleware — a breaking change under Next 16.

## Fix

Update `SYSTEM.md`:

1. Replace all `src/middleware.js` with `src/proxy.js` + `export const config = { matcher: "/api/:path*" }`.
2. State plainly: **no auth in proxy; every route calls `requireAuth()` itself.**

## Resolution — 2026-08-26

Fixed in SYSTEM.md during the doc-sync pass:

1. All `src/middleware.js` references replaced with `src/proxy.js` (§2 env config, §3 layout, §4.6, §10).
2. §4.6 rewritten to describe the actual policy: **fail-closed CORS lockdown** — same-origin passes, any other Origin gets 403, preflight answered only for `NEXT_PUBLIC_APP_URL`. The older `Access-Control-Allow-Origin: *` story (which SYSTEM.md also still told) was wrong in the opposite direction and is explicitly marked gone.
3. Behavior is locked by `src/security-boundaries.test.js`.

## Related

[[Framework Version Drift]] · [[Architecture]] · [[Authentication]] · [[Documentation Rot]] · [[Debugging Index]]
