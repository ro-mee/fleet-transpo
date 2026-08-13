---
type: debt
status: open
severity: sev-3
tags: [debt, docs, nextjs]
source:
  - SYSTEM.md
  - src/proxy.js
last_verified: 2026-08-11
---

# Doc Rot: SYSTEM.md References middleware.js

## The problem — CONFIRMED

`SYSTEM.md` references `src/middleware.js` in **three places**. **The file does not exist.**

Next 16 renamed middleware → **`src/proxy.js`** (exporting `proxy()`), which is where CORS lives. The auth flow is not in any proxy at all — it's per-route `requireAuth()`. See [[Authentication]].

## Why it's dangerous

Exactly the trap `AGENTS.md` warns about: *"This is NOT the Next.js you know."* A reader who checks `SYSTEM.md` for "where is auth wired" is sent to a nonexistent file; the real answer (`src/lib/api/utils.js` per-route) is never found. If they search for `middleware.js`, they conclude auth is missing and may "fix" it by adding a Next-15-style middleware — a breaking change under Next 16.

## Fix

Update `SYSTEM.md`:

1. Replace all `src/middleware.js` with `src/proxy.js` + `export const config = { matcher: "/api/:path*" }`.
2. State plainly: **no auth in proxy; every route calls `requireAuth()` itself.**

## Related

[[Framework Version Drift]] · [[Architecture]] · [[Authentication]] · [[Documentation Rot]] · [[Debugging Index]]
