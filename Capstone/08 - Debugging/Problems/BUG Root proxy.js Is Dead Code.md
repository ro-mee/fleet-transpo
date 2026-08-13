---
type: bug
status: fixed
severity: sev-2
fixed_on: 2026-08-11
tags: [bug, auth, dead-code, nextjs, fixed]
source:
  - proxy.js
  - src/proxy.js
  - node_modules/next/dist/build/index.js
last_verified: 2026-08-11
---

# Bug: Root proxy.js Is Dead Code

> **STATUS: FIXED 2026-08-11** — root `proxy.js` deleted via `git rm` (recoverable: it was tracked and clean).

## Symptom — CONFIRMED

Two files named `proxy.js` existed. Only one ran. The dead one described a **completely different authentication model** from the real one, so reading it taught you the wrong system.

| File | Size | Runs? | What it says |
|---|---|---|---|
| `src/proxy.js` | 594 B | ✅ **yes** | CORS preflight only, no auth |
| `proxy.js` (repo root) | 1989 B | ❌ **no** | `@supabase/ssr` + `supabase.auth.getUser()` → redirect `/login` |

## Root cause — CONFIRMED (verified against the bundler, not the docs)

The Next 16 docs say "project root, **or inside `src`** if applicable" and "**only one** `proxy.ts` file is supported per project". That still left the shadowing question open, so I read the build logic directly.

`node_modules/next/dist/build/index.js:617`:

```js
const rootDir = _path.default.join(pagesDir || appDir, '..');
```

This repo's app directory is **`src/app`**, so `rootDir` resolves to **`src/`**. The scan at line 633 then only collects files at convention level `'/'` or `'/src'`. **Next never reads the repo root for the proxy file.** The root `proxy.js` was not shadowed — it was never even scanned.

I also verified before deleting: no file anywhere imported it, it was the last commit to touch it at `52eeac1 "frontend skills"`, and it had no uncommitted changes.

## Why it is worth a note

This was a **comprehension bug**, not a runtime bug — nothing broke. But anyone who opened the root file concluded:

- auth happens in middleware (it does not; it is per-route via `requireAuth()`)
- Supabase Auth manages sessions (it does not; NextAuth v4 Credentials does)
- unauthenticated users are redirected (API routes return 401 JSON instead)

All three are wrong. See [[Authentication]] for what actually happens.

## How to prevent it

- When replacing an approach, delete the old file in the same commit.
- Dead code that *describes a system* is more dangerous than dead code that merely runs — it actively misleads.
- When docs and implementation disagree about precedence, read the implementation. `next/dist/build/index.js` is plain source and settles it.

## Related

[[Authentication]] · [[Architecture]] · [[Framework Version Drift]] · [[Debugging Index]] · [[Technical Debt]]
