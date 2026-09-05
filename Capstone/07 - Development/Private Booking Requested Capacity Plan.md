---
type: plan
title: Private Booking Requested Capacity
status: planned
tags: [plan, reservations, ai-advisory, dispatch, capacity]
source:
  - src/lib/integration/contracts.js
  - src/lib/integration/ingest.js
  - src/app/api/integration/transport-requests/route.js
  - src/app/api/integration/transport-requests/[id]/recommendation/route.js
  - src/app/api/integration/transport-requests/[id]/assign/route.js
  - src/lib/scheduling/conflicts.js
  - src/lib/ai/pair-scoring.js
  - src/services/recommendation.service.js
  - src/components/reservations/ai-recommendation-panel.jsx
  - src/components/dispatch/dispatch-edit-dialog.jsx
created: 2026-09-04
last_verified: 2026-09-04
related: ["[[Reservations]]", "[[AI Advisory]]", "[[Dispatch]]", "[[Request Lifecycle]]", "[[Roadmap]]"]
---

# Plan: Private Booking Requested Capacity

Goal: a private-booking client can request a vehicle **size** (e.g. 4 pax booking
a 5-seater), and Fleet intake, validation, Smart Dispatch ranking, dispatcher
UI, and manual-assignment guards all honor that request. Status: **planned —
not implemented.** Nothing below exists in the code yet (`requested_seating_capacity`
has zero hits on main).

This plan is **independent of shuttles**. The fundamental architecture stays
`1 request → 1 dispatch → 1 trip` (exclusive vehicle/driver assignment). There
is no `service_class`, no manifest, no shared capacity in scope.

## Locked decisions

1. **Booking owns the picker; Fleet validates/ranks/displays.** The seater
   choice UI lives in the Booking subsystem. Fleet receives it through the
   integration contract. `/reservations/new` only mirrors it (preset buttons +
   custom int) for simulation/testing.
2. **Exact-first + smallest-larger fallback, never smaller.** Exact seater ranks
   first; if none is eligible, the **smallest larger size wins before bigger
   ones** (7 before 10), then existing Smart Dispatch factors rank within the
   size. A smaller vehicle is always rejected — even when the passenger count
   alone would fit. If neither exact nor larger exists, the request stays
   **unassigned (NO MATCH)** — Fleet never downgrades size or silently changes
   category.
3. **Category wins.** `requested_category_id` stays a hard filter; capacity is
   a hard floor + tier preference *inside* the category.
4. **Seating semantics: OPTION A (verified 2026-09-04).** `vehicles.seating_capacity`
   counts **passenger seats, driver excluded**. Evidence: 22/24 live vehicles
   store `4`, and 4-stored vehicles routinely serve 3–4 passengers
   (RS-4IB3: 3 pax → 4-seat vehicle; RS-7I6X: 4 pax → 5-seat vehicle); API
   labels read `"Passenger capacity"` (`vehicles/route.js:13`,
   `vehicles/[id]/route.js:13`); boards render `"pax"`. The new
   `requested_seating_capacity` uses the same unit. If ops ever claims
   driver-inclusive counting, the change is one line inside the canonical
   helper — never in consumers.
5. **Wording: "Requested Vehicle Size", never "Preferred".** "Preferred"
   implies a smaller vehicle is acceptable; under these rules it is rejected.
   Three panel states: `Exact Match` ✅ vs `Larger Vehicle Fallback` ⚠️
   (satisfies the minimum, deviates from the request — always disclosed) vs
   `No Match` (request stays unassigned, per-vehicle reasons shown).
6. **No-preference = current behavior.** `requested_seating_capacity = NULL`
   means no size was requested: hard floor is `passenger_count` only, no
   exact/fallback tiers or badges, existing Smart Dispatch decides everything.

## Domain model — three independent concerns

| Field | Meaning | Example |
|---|---|---|
| `passenger_count` | how many people MUST fit (safety minimum) | 4 |
| `requested_category_id` (+ raw `requested_vehicle_type`) | what TYPE/class the guest asked for | SUV |
| `requested_seating_capacity` (NEW, nullable int) | what SIZE of that type the guest asked for | 5 |

Example reading: `4 pax + SUV + requested 5` → SUV-5 EXACT, SUV-7 FALLBACK,
Sedan-5 WRONG CATEGORY, SUV-4 TOO SMALL.

Do NOT reuse `requested_vehicle_type` for this — it is free text resolved to a
category (`category-resolver.js:87-128`); stuffing `"5-Seater"` into it
pollutes category matching.

## Canonical rules (single authorities)

1. **One seating helper, zero local reimplementations.** New pure module
   (e.g. `src/lib/scheduling/seat-requirement.js`):
   - `getSeatRequirement(request)` →
     `{ passengers, requestedSeats|null, effectiveMin, hasPreference }`
     where `effectiveMin = max(passengers, requestedSeats ?? passengers)`.
   - `evaluateSeatMatch(vehicle, request)` →
     `below_minimum | exact | larger_fallback | no_preference`.
   - **NO consumer computes seating rules itself.** The conflict engine
     (`conflicts.js:248-254`) and the dispatch-edit `seatsTooFew()`
     (`dispatch-edit-dialog.jsx:70-73`) are two independent implementations
     today — both move onto the helper or one of them will eventually forget
     the new field.
2. **Tiering, not bonus scoring.** The pair engine already stacks designated
   (+45), readiness (25+20), proximity, and workload fairness
   (`pair-scoring.js:421-447,515-554`) — a +20/+5 bonus cannot guarantee
   exact-first. Structure:
   ```
   HARD FILTERS (category, availability, pairing, docs, UVVRP, seats < effectiveMin)
     → seat-match partition → order WITHIN the winning tier only
   Tier A non-empty → recommend from Tier A (exact) only
   Tier A empty     → Tier B ordered by SMALLEST excess seats first
                       (7 before 10), ties broken by the existing
                       Smart Dispatch score + explicit fallback reason
   Tier B empty     → NO MATCH (request stays unassigned; never a smaller
                       vehicle, never a silent category switch)
   ```
   Capacity reasons stay in `scoreFleetPair` as explanation, not as the
   rank-decider across tiers.
3. **Seat floor is NON-OVERRIDABLE.** The assign endpoint explicitly supports
   `{ force: true }` over blocking conflicts (`assign/route.js:70-83`) and
   over the pairing check (`:88-104`). The seat/category gate runs
   before/outside that escape hatch. `force` MAY override operational
   warnings/scheduling exceptions; it MUST NOT override insufficient
   passenger capacity, the requested-size floor, or category mismatch.
4. **Snapshot invalidation belongs to the Booking update path.** The
   recommendation lifecycle already has consumed snapshots
   (`recommendation.service.js:101-127`, consumed in `assign/route.js:147-150`).
   Since Booking owns the field (no Fleet edit surface), a Booking-side size
   change persists → marks the unconsumed snapshot consumed server-side →
   recompute on next GET. No scattered UI invalidation.
5. **NULL = today's behavior, byte-identical.** `requested_seating_capacity =
   NULL` must produce the same recommendation, assign, edit, and conflict
   behavior as pre-feature FleetOps — for all legacy bookings. Concretely:
   `hasPreference: false`, `effectiveMin = passenger_count`,
   `evaluateSeatMatch` returns `no_preference` for every fitting vehicle (never
   exact/fallback), no badge is rendered, and a 5-seater recommended for 4 pax
   is just a "Recommended" vehicle — never labeled a fallback.
6. **Fleet never rewrites the customer's request.** Downgrading `5 → 4` seats
   or switching `SUV → Sedan` to force a match is forbidden at every layer
   (AI, conflicts, assign, edit, reassignment). The only legal revision path
   is Booking resubmits → snapshot invalidated (rule 4) → Smart Dispatch
   re-evaluates. A NO MATCH request keeps its status (`Pending` /
   needs-assignment) with dispatcher actions `[Retry Recommendation]`,
   `[View Availability]`, `[Reschedule]`.

## Phase 0 — Confirm inventory (no code)

- `097_requested_seating_capacity.sql` still free (verified 2026-09-04; the
  shuttle note reserving 097 is gone).
- Re-read suite size (`npm run test:run`); don't hardcode counts.

## Phase 1 — Schema (`097_requested_seating_capacity.sql`)

```sql
BEGIN;
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS requested_seating_capacity INT;
ALTER TABLE transportation_requests
  DROP CONSTRAINT IF EXISTS chk_transport_requested_seats;
ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_requested_seats
  CHECK (requested_seating_capacity IS NULL OR requested_seating_capacity > 0);
CREATE INDEX IF NOT EXISTS idx_transport_req_seating
  ON transportation_requests(requested_seating_capacity);
COMMIT;
```

No cross-column CHECK against `passenger_count` (would break existing rows and
later edits — enforced in contract/app instead). Apply per repo policy:
`npm run db:up` → `npm run db:dump` → commit the `schema.sql` diff. Verify via
`information_schema`.

## Phase 2 — Intake contract (Booking boundary)

- `contracts.js:37-47`: add `requested_seating_capacity` (optional, nullable,
  int 1–50) + refinement: `passengers > requested → 400` with a clear message.
  Optional/backward-compatible — legacy payloads behave exactly as today.
- `ingest.js:82-109`: persist the column; include it in timeline metadata.
  Both doors (push + pull) inherit it via `ingestRequest()`.

## Phase 3 — Engine (AI must read the request)

- Candidate SQL (`recommendation/route.js:174-180`): floor becomes
  `effectiveMin`; category hard filter unchanged (Category-wins).
- `buildFleetPairRecommendations` (`pair-scoring.js:596-600`): skip
  `below_minimum` with reason (`Seats X — below requested Y-seater`); partition
  survivors into Tier A (exact) / Tier B (larger); Tier B ordered by smallest
  excess capacity first, existing score breaking ties. Worked example
  (`4 pax + SUV + requested 5`; SUV-4 ❌, SUV-5 unavailable, SUV-7 ✅, SUV-10 ✅):
  recommend the 7-seater as `LARGER VEHICLE FALLBACK — no eligible 5-seater SUV
  in the window; smallest vehicle that still satisfies the request`.
- NO MATCH: when Tier A and Tier B are both empty, return no recommendation
  with per-vehicle reasons (`5-seater — schedule conflict`, `7-seater —
  already dispatched`, `10-seater — under maintenance`) plus the explicit line
  `No smaller vehicle will be assigned`. Request stays unassigned.
- `buildChecklist` (`pair-scoring.js:689-762`): add
  `Exact Match: 5 requested · 5 assigned` vs
  `Larger Fallback: 5 requested · 7 recommended — no eligible 5-seater in window`.
  No silent fallback.
- Booking-side size change invalidates the unconsumed snapshot (rule 4).

## Phase 4 — Enforcement gates (manual paths cannot bypass AI)

- `conflicts.js:248-254`: blocking `CAPACITY_MISMATCH` against `effectiveMin`,
  with distinct below-request vs below-passenger messages.
- Assign `PUT`: seat/category gate outside the `force` hatch (rule 3); forced
  overrides still recorded in timeline metadata as today.
- Dispatch edit + reassignment: same helper; prevent downgrade to
  `below_minimum`; pickers hide/disable smaller vehicles with reasons.

## Phase 5 — Dispatcher display + simulator mirror

- Reservation detail, queue card, `ai-recommendation-panel.jsx:180-184,313-348`:
  `REQUESTED VEHICLE SIZE: 5-seater · 4 passengers` block with exactly one of
  three states — `EXACT MATCH` (5 requested · 5 assigned) /
  `LARGER VEHICLE FALLBACK` (5 requested · 7 recommended + reason) /
  `NO MATCH` (request + per-vehicle unavailability reasons + `No smaller
  vehicle will be assigned`). Panel currently renders zero preference state —
  this is new UI reusing `none_reasons` + `RiskList`.
- No-preference display: `CUSTOMER REQUEST: 4 passengers · Vehicle size: no
  specific size requested` → plain `Recommended: SUV · 4 seats · fits 4
  passengers`, no badge.
- `/reservations/new` (`page.js:320-345`): `Requested Vehicle Size` preset
  buttons `[4|5|7|Van=14]` + custom int; client-side block when
  `passengers > requested`. Labeled request/preference, never "assigned".

## Phase 6 — Tests + verification

Unit (pure, alongside existing suites): ingest `6 pax + 5 → 400`; `4 + 5` →
4 rejected / 5 exact / 7 fallback; `4 + 5 + SUV` → Sedan-5 rejected by
category; exact-5 beats higher-scored-7 (tier proof); no exact-5 → 7 wins +
reason; manual 4-seater → 409 **even with `force: true`**; edit/reassign
downgrade → reject; `NULL` → identical to today; Booking `5 → 7` kills the old
snapshot. Full suite green. Manual: seed 4/5/7/10-seat vehicles, book 4 pax + 5,
confirm exact picked; block all 5s, confirm 7 beats 10 with reason; block 7+10,
confirm NO MATCH with per-vehicle reasons and unassigned status; book 4 pax +
NULL, confirm no badge and same result as today.

## Verification per phase

| Phase | Check |
|---|---|
| 1 | `db:status` clean; `db:dump` diff reviewed |
| 2 | 400 on `passengers > requested`; legacy payload unchanged |
| 3 | Tier proof test; fallback carries explicit reason |
| 4 | `force: true` cannot override seat floor (regression test) |
| 5 | Dispatcher sees request + Exact/Fallback badge; simulator blocks invalid |
| 6 | Full suite green; manual exact + fallback scenarios |

## Deliberately not built

- Shuttle anything: `service_class`, manifests, `dispatch_request_links`,
  boarding states, open runs, multi-request dispatch, shared capacity.
- Seat maps, upgrade pricing, persisted run snapshots.
- Touching `trg_dispatch_overlap`; real Booking gateway wiring
  (`BOOKING_GATEWAY=mock` stays); Fleet-side editing of the requested size.
- Booking-side `allow_larger_fallback` opt-in checkbox — deferred unless the
  real Booking flow needs it; current rule (exact → disclosed larger fallback →
  never smaller) already covers operations.
- Seed renames (`VIP Guest Transport — 7`, `Guest Shuttle & Airport Transfer —
  14` in `vehicle-categories/route.js:5-10` predate this feature and confuse
  private-booking language — suggested follow-up, not this plan).

## Related

[[Reservations]] · [[AI Advisory]] · [[Dispatch]] · [[Request Lifecycle]] · [[Roadmap]]
