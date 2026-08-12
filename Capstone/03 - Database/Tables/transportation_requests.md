---
type: table
title: transportation_requests
tags: [database, table, core]
source:
  - supabase/migrations/016_reservation_module.sql
  - supabase/migrations/012_status_constraints.sql
  - src/services/reservation-lifecycle.service.js
last_verified: 2026-08-11
---

# Table: transportation_requests

**The core table of the system.** 15 rows. Every guest transportation request lives here.

Despite the name, this — not `vehiclereservations` — is what the app reads and writes. See [[DEBT vehiclereservations vs transportation_requests]].

## Purpose

Holds a request from intake through to completion, carrying both **what Booking asked for** and **what Fleet decided**.

## Key columns — CONFIRMED

| Column | Why it matters |
|---|---|
| `status` | 9-value CHECK. The reservation state machine. → [[Reservation State Machine]] |
| `priority` | `Urgent/High/Medium/Low` via `chk_transport_priority`. Booking's `"Normal"` is translated at ingest. |
| `external_booking_id` | The parent system's key. **Idempotency key** on the push path. Never mutated by Fleet. |
| `reservation_number` | `VARCHAR(30) UNIQUE`, added by 016. Human-facing id. Only assigned on the push path. |
| `requested_vehicle_type` | **Free text, kept verbatim** — what the guest actually asked for |
| `requested_category_id` | FK to `vehiclecategories`, resolved from the free text at ingest. Nullable — resolution may fail and the request survives. |

The `requested_vehicle_type` / `requested_category_id` pair is the most instructive design choice in the schema: **keep the raw input and the interpretation side by side.** → [[Anti-Corruption Layer]]

## Status vocabulary — CONFIRMED (9 values)

`Pending` · `Under Review` · `Approved` · `Rejected` · `Scheduled` · `Assigned` · `In Progress` · `Completed` · `Cancelled`

Migration `016_reservation_module.sql` **retired an earlier 10-status vocabulary** from 015, back-filled existing rows, then applied the 9-value CHECK — and normalised `Normal` → `Medium` in `priority` at the same time.

## The single-writer rule — CONFIRMED

`advanceReservation()` in `src/services/reservation-lifecycle.service.js` is the **only** function that should change `status`. It validates the transition, writes the row, appends a `reservation_events` entry, and emits an outbound status.

Bypassing it produces a status change with no audit trail. → [[ADR-007 Single Writer For Reservation Status]]

## Relationships

- → [[reservation_events]] (1:N) — the timeline
- → [[dispatchschedules]] (1:N) via `request_id` — the resource booking
- → [[integration_log]] (1:N) — outbound status events
- ← `vehiclecategories` via `requested_category_id`

## Gotchas

1. **Two ingest paths write it differently.** Pull-sourced rows lack `reservation_number`, a resolved category, and a `CREATED` event. → [[DEBT Ingest Paths Diverge]]
2. **Absent from both ERDs** in `docs/erd/`. → [[DOC ERDs Missing Core Table]]
3. `status` here is one of **three** parallel status vocabularies. → [[Data Flow]]

## Related

[[Reservations]] · [[Request Lifecycle]] · [[Database Overview]] · [[ERD]] · [[System Boundaries]]
