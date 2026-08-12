---
type: learning
tags: [learning, database, postgres, concurrency]
source:
  - src/lib/db.js
last_verified: 2026-08-11
---

# Concept: Connection Pooling vs Transactions

## What it is

A **pool** hands out a connection per query and takes it back immediately. That's what makes it efficient — a handful of connections serve hundreds of requests.

A **transaction** is a property *of one connection*. `BEGIN` on connection 3 means nothing to connection 7.

So a pool's convenience and a transaction's requirement are in direct tension: the moment you need two statements to be atomic, you must **hold one connection** across both and hand it back yourself.

## Why it matters

The failure is silent and intermittent. Firing `BEGIN`, `UPDATE`, `COMMIT` through a pool helper can route each statement to a different connection: the `BEGIN` opens a transaction nobody uses, the `UPDATE` autocommits, the `COMMIT` commits nothing. It works fine under light load and corrupts data under concurrency.

## How it appears in my project — CONFIRMED

`src/lib/db.js` exposes both, and the distinction is documented at `src/lib/db.js:56-72`:

| Helper | Connection behaviour | Use for |
|---|---|---|
| `query()` | checks out per call, returns immediately | single statements |
| `withTransaction(fn)` | one connection for the whole callback | multi-statement atomicity |

The docstring names the exact scenario that forced it:

> *"`query()` checks a connection out per call… notably reassigning a driver's vehicle, where the old pairing has to close and the new one open atomically or the `uq_dva_active_*` partial unique indexes reject the pair mid-flight."*

## Why the constraint forces the transaction

`driver_vehicle_assignments` has **partial unique indexes** — at most one *active* row per driver and per vehicle. Reassignment is two writes: close the old row, open the new one.

```
close old  →  open new     ✅ atomic, constraint never sees two active rows
open new                   ❌ two active rows for that driver → index rejects
```

Split across two pooled calls, the intermediate state is real and visible, and the index does exactly what you asked it to: it refuses. → [[driver_vehicle_assignments]]

**The constraint isn't the problem — it's the thing telling you the operation was never atomic.**

## Example from my codebase

```js
await withTransaction(async (client) => {
  await client.query("UPDATE driver_vehicle_assignments SET … WHERE …");
  await client.query("INSERT INTO driver_vehicle_assignments …");
});
```

The callback receives `client`, not the pool. Using `query()` inside a `withTransaction` callback is the classic bug — it grabs a *different* connection and silently escapes the transaction.

## Common mistakes

| Mistake | Consequence |
|---|---|
| `query("BEGIN")` on a pool | Statements land on different connections |
| Calling `query()` inside `withTransaction` | That statement isn't in the transaction |
| Forgetting `client.release()` in hand-rolled code | Pool exhaustion, app hangs |
| `await fetch()` inside a transaction | Holds a connection for the length of a network call |
| Assuming an ORM handles it | Only if you pass its transaction handle down |

## Related concepts

[[TOCTOU And Advisory Locks]] · [[driver_vehicle_assignments]] · [[Backend]] · [[ADR-004 Dual Database Access]] · [[Learning Dashboard]]
