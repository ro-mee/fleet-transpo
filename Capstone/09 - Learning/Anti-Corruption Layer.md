---
type: learning
tags: [learning, architecture, ddd, integration]
source:
  - src/lib/integration/contracts.js
  - src/lib/integration/
last_verified: 2026-08-11
---

# Concept: Anti-Corruption Layer

## What it is

A translation boundary between your model and an external system's model. Nothing from outside enters your domain in its original shape — it's validated and rewritten at the edge first.

From DDD: without it, the external model **leaks inward**. Their field names, their status values, their assumptions end up in your database and your UI, and you're permanently coupled to a system you don't control.

## Why it matters

The external system will change. Someone will add a priority level, rename a field, send `null` where they never did. Without a translation layer, that change propagates to every file that touched the data. With one, it breaks in a single module — where a test can catch it.

## How it appears in my project — CONFIRMED

`src/lib/integration/` is the boundary between Booking/PMS and Fleet. It does three distinct translations:

| Translation | Direction | What it does |
|---|---|---|
| **Shape** | in | Zod schemas validate the payload before anything is trusted |
| **Priority** | in | Booking's vocabulary → Fleet's, unknown values → `Medium` |
| **Status** | out | Fleet's 9 internal states → 7 external ones |

That last one is the most important and the least obvious. → [[System Boundaries]]

## Example from my codebase

`src/lib/integration/contracts.js`:

> *"anything unrecognized degrades to Medium rather than throwing, so a vocabulary drift on Booking's side can never block ingest."*

That's the whole philosophy in one line. A new priority value on their side is **not an outage** on yours — it's a slightly-wrong priority on one request, visible in [[integration_log]] and fixable later. → [[Graceful Degradation]]

And:

> *"Deliberately NO branch field (single-org Fleet; see migration 013)."*

Booking sends a branch. Fleet **drops it**, on purpose, with the reason and the migration number recorded at the point of the decision. That's an ACL doing its job: refusing a concept your model doesn't have, instead of storing it "just in case." → [[ADR-001 Single Organization]]

## Why collapse 9 statuses into 7

Internal states like `Pending Reassignment` are Fleet's operational business. Booking needs to know whether the vehicle is coming — not how many times dispatch reshuffled. Exposing all 9 would make internal refactors into breaking API changes for a partner.

**The external vocabulary is a contract. The internal one is an implementation detail.** Keeping them separate is what buys you freedom to change.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Storing the external payload verbatim | Their schema becomes yours forever |
| Throwing on unknown enum values | Their release breaks your ingest |
| One-to-one status mapping | Every internal state change is an API break |
| Translating in the route handler | Every new entry point re-implements it |
| Keeping fields "just in case" | Dead columns nobody dares drop |

## Related concepts

[[System Boundaries]] · [[Graceful Degradation]] · [[Pure Core Imperative Shell]] · [[ADR-002 Anti-Corruption Layer]] · [[Data Flow]] · [[Learning Dashboard]]
