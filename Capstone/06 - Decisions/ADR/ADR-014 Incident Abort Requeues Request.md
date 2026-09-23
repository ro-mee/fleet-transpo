---
type: adr
number: 014
title: Incident Abort Requeues Request
date: 2026-09-23
status: accepted
tags: [decision, incidents, reservations, dispatch, state-machine]
---

# ADR-014: Incident Abort Requeues Request

## Context

Grounding an **In Progress** dispatch used to `UPDATE transportation_requests SET fleet_status = 'Cancelled'` and write a `CANCELLED` event. That killed the guest's request even though the guest still needed transport — the stranded-guest page told dispatchers to arrange a replacement, but the queue had nothing left to assign. Scheduled dispatches already dropped to `Pending Reassignment`; only the in-progress path cancelled.

## Decision

1. **Abort the run, not the request.** In `grounding.js`'s In Progress branch: cancel the trip, set the dispatch to `Pending Reassignment` (clear `vehicle_id`/`driver_id`), set `fleet_status = Scheduled` with pair cleared and `status_reason = ABORTED…`, insert `INCIDENT_REQUEUED` (not `CANCELLED`).
2. **Add one reverse edge** to the reservation adjacency map: `In Progress → Scheduled`. Every other backward hop stays illegal. `transitionPath` BFS picks it up automatically.
3. **Re-derive priority** best-effort after requeue so a past pickup becomes **Overdue** (the request is back in `ACTIVE_NOT_STARTED`).
4. **Queue surfaces the interrupt.** The list GET LEFT JOINs the latest non-deleted dispatch; `dispatch_status = 'Pending Reassignment'` renders a **Needs reassignment** pill, sorts first in the tab, and matches `?filter=reassignment`.

## Consequences

- Guest lifecycle is no longer destroyed by a vehicle incident; the queue owns the replacement assignment.
- `advanceReservation` remains the single writer for normal hops; the grounding transaction is a deliberate exception (same class as the pre-existing raw Cancelled write) and records its own event.
- Outbound `emitTransportStatus` is not fired from the raw SQL path (pre-existing gap for cancel-in-grounding too); Booking still sees the last external status until the next hop.
- Leave approval already used `Pending Reassignment` on the dispatch side — now both interrupt paths surface in one queue pill.

→ [[Incidents]] · [[Reservation State Machine]] · [[Reservations]] · [[Dispatch State Machine]]
