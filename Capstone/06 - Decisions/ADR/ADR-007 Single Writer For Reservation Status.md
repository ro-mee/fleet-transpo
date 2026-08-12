---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, reservations, audit]
source:
  - src/services/reservation-lifecycle.service.js
  - src/lib/scheduling/reservation-state.js
last_verified: 2026-08-11
---

# ADR-007: Single Writer For Reservation Status

## Context

A request's status changes from many places: the review UI, the approve endpoint, dispatch creation, trip start, trip completion, cancellation, and inbound status from Booking. Each transition must be validated, audited, and reported outbound.

## Decision — INFERRED from structure, not stated

**One function owns the write:** `advanceReservation()` in `src/services/reservation-lifecycle.service.js`.

It does four things atomically-ish:

```
1. validate the transition against the adjacency map (reservation-state.js)
2. UPDATE transportation_requests.status
3. INSERT a reservation_events row (the timeline)
4. emitTransportStatus() → integration_log + outbound gateway call
```

⚠ **This is an inference from code structure, not a documented decision.** No comment states "only this function may write status." The pattern is consistent across the call sites read, but nothing enforces it and nothing declares it.

## Why it matters

Steps 2, 3, and 4 must happen together. A bare `UPDATE transportation_requests SET status = 'Approved'` produces:

- ✅ the status change
- ❌ no timeline entry — [[reservation_events]] (69 rows) silently loses an event
- ❌ no outbound notification — Booking never learns
- ❌ no transition validation — an illegal state becomes reachable

The failure is **silent**. Nothing errors; the audit trail just has a hole.

## Consequences

**Good:**
- Every status change is validated, timelined, and reported — as long as the rule is followed
- The timeline in `reservation_events` is trustworthy
- One place to change if the lifecycle evolves

**Costs and risks:**
- **Nothing enforces it.** A new route can `UPDATE` directly and nothing complains.
- Not documented, so a new contributor has no way to know the rule exists
- The dispatch and trip routes already contain inline `UPDATE ... SET status` calls for the *dispatch* and *trip* vocabularies — so the codebase does mix direct updates with service calls, which weakens the pattern by example

## How to make it real

1. **State it** in a comment at the top of `reservation-lifecycle.service.js`
2. **Grep-test it:** a check that no file outside the service contains `UPDATE transportation_requests SET status`
3. Or **enforce it in the DB** — a trigger that rejects a status change unless a matching `reservation_events` row is written in the same transaction

Option 3 matches how [[ADR-006 Dual Double-Booking Guard]] handles a similar "must not be bypassable" problem.

## Revisit if

- A direct-update bypass is found in the wild (that's the signal the convention has already failed)
- The lifecycle grows enough that one function becomes unwieldy

## Related

[[Reservations]] · [[Request Lifecycle]] · [[reservation_events]] · [[transportation_requests]] · [[Decision Log]] · [[Services]]
