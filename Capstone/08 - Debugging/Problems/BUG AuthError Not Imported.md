---
type: bug
status: fixed
severity: sev-1
fixed_on: 2026-08-11
tags: [bug, trips, error-handling, fixed]
source:
  - src/app/api/trips/[id]/start/route.js
  - src/lib/api/utils.js
  - eslint.config.mjs
last_verified: 2026-08-11
---

# Bug: AuthError Not Imported

> **STATUS: FIXED 2026-08-11.**

## Symptom — CONFIRMED

Starting a trip whose id does not exist should return **404 "Trip not found"**. Instead the handler threw `ReferenceError: AuthError is not defined`, which surfaced as a **500**.

## Root cause — CONFIRMED

`src/app/api/trips/[id]/start/route.js:67`:

```js
if (!r.rows[0]) throw new AuthError("Trip not found", 404);
```

`AuthError` was **never imported**. The import block brought in `requireAuth, parseBody, ok, err, handleError` from `src/lib/api/utils.js` — but not `AuthError`.

## The fix — CONFIRMED

The earlier TODO on this note asked to verify the export name first. Verified: `src/lib/api/utils.js:83` exports `class AuthError extends Error`, and `handleError` (line 115) branches on `error instanceof AuthError` to map `.status` onto the response. The name was right; only the import was missing.

```js
import { requireAuth, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
```

Worth noting the throw is *inside* `withTransaction`. Throwing there rolls the transaction back before `handleError` converts it to a 404 — so the intended design was sound, and the missing import was the whole defect.

## Why it survived — CONFIRMED

Originally filed as INFERRED "it sits on a cold path". That's true but not the real reason. The actual reason is now confirmed: **`no-undef` is not enabled in this repo's ESLint config.** Nothing was checking for undefined identifiers in plain `.js`, so the bug was invisible to tooling *and* to the cold path.

The JSX equivalent (`react/jsx-no-undef`) **is** on — and it caught two more instances of the exact same bug class the moment I looked:

- `src/components/reservations/assign-dialog.jsx:298` — `Badge` used, never imported
- `src/components/reservations/assign-dialog.jsx:306` — `Search` used, never imported

Both fixed the same way (`@/components/ui/badge` and `lucide-react`, matching how sibling components import them). Unlike the trip route, these were **not** cold paths — `Badge` renders whenever a reservation has a required vehicle class, and `Search` whenever a dispatcher has more than 3 assignment options. Both would have crashed the assign dialog on render.

That is the useful lesson: the same defect was latent in a cold path and live in a hot one, and only the hot one had a lint rule pointed at it.

## How to prevent it — DONE 2026-08-11

- ~~**Enable `no-undef`** for `.js` files.~~ **Enabled**, in `eslint.config.mjs`,
  with browser + node + serviceworker globals and Expo's `__DEV__` (which is in
  no `globals` preset). `mobile/dist/**` is ignored — it is gitignored Expo build
  output and produced **772 of the 773** initial errors, which nearly buried the
  one real finding.
- **It immediately found a fourth instance**: `setRequestFlags` used but never
  imported in `src/app/(dashboard)/reservations/queue/page.js`. That one had
  never fired at all — `flagsMutation` is referenced nowhere else, so the write
  path was wired to no control. The API route, the service function, and the
  read-only VIP/Emergency badges all exist; only the trigger is missing.
- Test the **failure** branches, not just the happy path.
- Note that installing vitest did *not* catch this one — there are no route-level tests, only pure-function tests. A green suite covers what it covers.

**Final tally for this bug class: four instances.** Two in `.jsx` caught by
`react/jsx-no-undef`, two in `.js` that nothing was checking. Lint went from
60 errors to 38, and `no-undef` now reports **zero**.

The count is the point. A statically-detectable defect recurred four times
because the rule that detects it was off — and the rule was off by default,
not by decision. [[Documentation Rot]] is the documentation version of this;
this is the tooling version.

## Related code

`src/lib/api/utils.js` · [[Trips]] · [[Backend]] · [[Error Handling Patterns]]

## Related

[[Debugging Index]] · [[Bugs]] · [[Current State]] · [[Testing]]
