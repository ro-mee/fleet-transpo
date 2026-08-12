---
type: learning
tags: [learning, api, error-handling]
source:
  - src/lib/api/utils.js
  - src/app/api/trips/[id]/start/route.js
last_verified: 2026-08-11
---

# Concept: Error Handling Patterns

## What it is

Deciding, once and for the whole codebase, how a handler signals failure — and making sure the signal survives all the way to the caller as the status code you intended.

## The canonical shape in this project — CONFIRMED

Every well-formed route in `src/app/api/**/route.js` follows four steps:

```
1. auth        requireAuth(req) / requireDriver(req)   → throws on failure
2. validate    zod parse of params + body              → throws on failure
3. act         query() or withTransaction()
4. respond     NextResponse.json(...)
```

Errors are **thrown**, not returned, and a shared catch maps them to status codes. That keeps the happy path linear — no `if (!ok) return` after every line. → [[Backend]]

## Why a typed error class

`AuthError(message, status)` carries the status with the error. A plain `throw new Error("Trip not found")` loses the intent, and the catch has no way to distinguish 404 from 500 except by string-matching the message — which breaks the first time someone rewords it.

## Where it breaks — CONFIRMED

`src/app/api/trips/[id]/start/route.js:67`:

```js
throw new AuthError("Trip not found", 404);
```

**`AuthError` is not imported in this file.** Evaluating the identifier throws `ReferenceError` before the intended error is ever constructed. The caller receives **500**, not 404.

Two things worth extracting from this one line:

1. **The failure is on the failure path.** The route works perfectly for valid trips; the bug only fires when something already went wrong. Error paths are exactly the code least likely to be exercised by hand.
2. **Plain JS + no tests = no signal.** A linter with `no-undef`, or types, or one test hitting a missing trip, catches this instantly. None of the three is running. → [[BUG AuthError Not Imported]] · [[DEBT Vitest Not Installed]]

And it undoes a deliberate security choice: the 404 was there so drivers couldn't enumerate trip ids. A 500 restores the oracle. → [[Anti Enumeration 404 vs 403]]

## What a good catch layer does

| Concern | Rule |
|---|---|
| Status | From the error type, never from message text |
| Client message | Safe and generic — no SQL, no stack, no internal ids |
| Server log | Everything, with the request id |
| Unknown errors | 500 — never leak the raw message |
| DB error codes | Map deliberately: `'P0001'` → 409 → [[ADR-006 Dual Double-Booking Guard]] |

That last row matters here: the overlap trigger raises `P0001`. If the catch layer doesn't recognise it, a legitimate booking conflict is reported to the dispatcher as a server error, and they retry a request that will never succeed. **A conflict is a 409 — the caller must be told it's their input, not your outage.**

## Common mistakes

| Mistake | Consequence |
|---|---|
| Throwing an error class you didn't import | `ReferenceError` → 500 |
| String-matching messages to pick a status | Breaks on rewording, breaks on i18n |
| Returning error objects from some handlers, throwing in others | Two contracts, half the catches miss |
| `catch {}` | Silent failure — the worst outcome |
| Leaking `err.message` to the client | Leaks schema and internals |
| Untested error branches | The only branch that matters when things are bad |

## Related concepts

[[Backend]] · [[Anti Enumeration 404 vs 403]] · [[Graceful Degradation]] · [[BUG AuthError Not Imported]] · [[Testing]] · [[Learning Dashboard]]
