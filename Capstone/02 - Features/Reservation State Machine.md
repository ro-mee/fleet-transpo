---
type: reference
title: Reservation State Machine
tags: [state-machine, reservations]
source:
  - src/lib/reservations/
  - src/lib/integration/contracts.js
last_verified: 2026-08-11
---

# Reservation State Machine

**9 states, adjacency map, plus BFS.** The most elaborate of the three machines — and the only one that can compute a *path* rather than just validate a single hop.

## Why an adjacency map here

[[Trip State Machine]] and [[Dispatch State Machine]] use rank monotonicity, which is cheaper. Reservations don't fit that shape: the legal moves aren't a straight line, and some states are reachable from several places and not from others. Ranks encode *ordering*; an adjacency map encodes an arbitrary graph.

## `transitionPath` — the distinctive part

```
transitionPath(from, to) → the sequence of intermediate states to walk
```

A breadth-first search over the adjacency map returns the **shortest legal walk**. Callers that want an end state don't have to know the intermediate steps — the machine works them out, and every step it emits is individually legal.

Two consequences worth being aware of:

- **Shortest, not "correct".** BFS returns *a* legal path. If two paths exist with different business meaning, it picks by graph distance, not by intent.
- **Every intermediate state is really entered**, so anything that fires on those states — including the notification triggers — fires for each one. → [[ADR-005 Notifications In Database Triggers]]

## The single-writer rule

Reservation status has exactly **one** authoritative writer. Nothing else updates the column directly — status changes go through the machine, so every transition is validated and recorded in [[reservation_events]] (69 rows, the richest audit trail in the database).

That's what makes the audit trail trustworthy: not discipline, but the absence of a second write path. → [[ADR-007 Single Writer For Reservation Status]]

## The external vocabulary is different — CONFIRMED

These 9 internal states collapse to **7** on the way out to Booking. Internal operational states are not part of the external contract.

> *"Deliberately NO branch field (single-org Fleet; see migration 013)."* — `src/lib/integration/contracts.js`

Keeping the two vocabularies separate is what lets you add or rename an internal state without breaking a partner integration. → [[Anti-Corruption Layer]] · [[System Boundaries]]

## Where the rows actually live — CONFIRMED

The product moved to `transportation_requests` in migration 016.
`vehiclereservations` lingered empty until migration 036 dropped it (2026-08-11),
along with the `reservation_id` sync branch that never fired because live rows
carry `request_id`.

So: **this machine governs `transportation_requests`**, and now there is nothing
else it could be confused with. → [[transportation_requests]] · [[DEBT vehiclereservations vs transportation_requests]]

## Related

[[Reservations]] · [[Request Lifecycle]] · [[State Machines]] · [[reservation_events]] · [[transportation_requests]] · [[ADR-007 Single Writer For Reservation Status]]
