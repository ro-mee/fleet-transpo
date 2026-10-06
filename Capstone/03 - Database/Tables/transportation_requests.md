---
type: table
title: transportation_requests
tags: [database, table, core]
source:
  - supabase/migrations/016_reservation_module.sql
  - supabase/migrations/012_status_constraints.sql
  - supabase/migrations/146_location_intake_identity.sql
  - src/services/reservation-lifecycle.service.js
last_verified: 2026-10-06
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

## Prepared typed-load extension — Task 2, 2026-10-05 (NOT applied)

Draft migration `145_load_types_and_services.sql` (provisional number, after draft identity migration 144) adds `load_type` (`Passenger` by default for historical rows), nullable cargo `passenger_count` with its old DB default removed, positive `cargo_weight_kg` numeric(12,3), required cargo description, and optional source department. A CHECK requires positive passenger counts and no cargo fields for passenger rows, or null passengers and positive, non-NaN weight/nonblank description for cargo. A preflight aborts atomically on historical passenger counts ≤0; no historical counts are rewritten. No live migration, schema dump, or catalog/data verification was run. Deploy prepared migrations in order before enabling corresponding application code; until then INSERT/GET queries reference nonexistent columns.

`service_types` gains unique `service_code` and nullable `default_load_type` for unclassified custom history. Five canonical codes are seeded and verified for kind/name/active status; explicit retired names (`Staff Transport`, `Employee Transport`, `Hotel Shuttle`, `Guest Shuttle`) are marked Inactive, retaining historical FK rows. Unknown legacy names remain untouched. App create resolves active code to internal `service_type_id`; historical rows are not recategorized. SQL CHECK does not itself enforce service-code/load compatibility across this FK: all non-app DB writers must validate the same invariant.

## Prepared partner proposal fields — Task 1, 2026-10-06 (NOT applied)

Migration `146_location_intake_identity.sql` adds nullable JSONB `partner_pickup_location_proposal` and `partner_dropoff_location_proposal` columns. Each check accepts only an object containing `address`, `latitude`, and/or `longitude`; a proposal needs a nonempty address or a complete coordinate pair. An address is capped at 2,000 characters. Coordinates must both be absent/null or both finite and within latitude `[-90, 90]` and longitude `[-180, 180]`; partial pairs, unsupported keys, non-object values, and empty proposals are rejected.

The JSONB is explicitly partner-provided review data, not canonical routing data. Task 1 adds storage constraints only; the ingest writer, request read projections, and dispatcher mapping are later work. The migration is not applied, so this schema is not yet available in the live database.

## Related

[[Reservations]] · [[Request Lifecycle]] · [[Database Overview]] · [[ERD]] · [[System Boundaries]]
