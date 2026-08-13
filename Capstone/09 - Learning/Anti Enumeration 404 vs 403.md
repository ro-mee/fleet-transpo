---
type: learning
tags: [learning, security, api]
source:
  - src/lib/api/utils.js
  - src/app/api/trips/
last_verified: 2026-08-11
---

# Concept: Anti Enumeration — 404 vs 403

## What it is

When a caller asks for a resource they aren't allowed to see, you can answer two ways:

- **403 Forbidden** — "it exists, you can't have it"
- **404 Not Found** — "as far as you're concerned, there's nothing here"

403 is more honest and **leaks existence**. Loop over ids and the difference between 403 and 404 maps out your whole table: how many trips exist, and their id density.

## Why it matters

Existence is information. "Driver 12 has a trip today" can be sensitive even when the contents aren't. And an id space you can enumerate is the reconnaissance step before you look for the endpoint that *forgot* its check.

## How it appears in my project — CONFIRMED

`assertTripOwnership()` returns **404** when a driver requests a trip that isn't theirs — not 403. A driver walking `/api/trips/1`…`/api/trips/999` learns nothing about which ids exist.

The trade-off is accepted deliberately: a legitimately confused caller gets a slightly less helpful message.

## Example from my codebase

The related bug is instructive. `src/app/api/trips/[id]/start/route.js:67`:

```js
throw new AuthError("Trip not found", 404);
```

`AuthError` is **never imported in that file**. The intended 404 becomes a `ReferenceError` → 500. So the not-found path leaks a different signal: *this endpoint crashes for ids you don't own and 404s for ids that don't exist.* Same enumeration oracle, now via status class. → [[BUG AuthError Not Imported]]

**A security decision implemented on an untested path isn't implemented.**

## When 403 is right

Not always wrong. Prefer 403 when:

- The caller already knows the resource exists (it's in a list they can see)
- The id isn't guessable (UUIDv4 — enumeration is infeasible anyway)
- Operators need to distinguish "misconfigured permission" from "typo'd id"

Fleet uses **integer ids** on trips, which is exactly the case where enumeration is cheap and 404 earns its keep. → [[Trips]]

## Common mistakes

| Mistake | Consequence |
|---|---|
| 403 on guessable integer ids | Free table census |
| Different response *times* for the two cases | Timing side channel restores the oracle |
| Error body says "not authorized" with a 404 status | The body leaks what the status hid |
| Only the detail route checks ownership | The list route returns everything |

## Related concepts

[[Fail Closed By Default]] · [[RBAC]] · [[Authentication]] · [[Defence In Depth]] · [[BUG AuthError Not Imported]] · [[Learning Dashboard]]
