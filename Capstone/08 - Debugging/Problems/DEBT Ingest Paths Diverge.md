---
type: debt
status: resolved
severity: sev-3
tags: [debt, integration, reservations, resolved]
source:
  - src/lib/integration/ingest.js
  - src/app/api/integration/pull/route.js
  - src/app/api/integration/transport-requests/route.js
  - src/lib/integration/ingest.test.js
resolved: 2026-08-11
resolved_by: 2e3f95a
last_verified: 2026-08-11
---

# Debt: Ingest Paths Diverge

> **RESOLVED 2026-08-11** (roadmap Phase 3, item 12 — commit `2e3f95a`).
> Both doors now call one shared writer, `ingestRequest()` in
> `src/lib/integration/ingest.js`. Fixed by **unification** (option 2), because
> pull is not dead code — `src/services/transport.service.js:112` wires it to a
> live UI button.

## The problem — CONFIRMED, but this note originally overstated it

Two inbound entry points produced **different-quality rows from the same
payload**. The pull path inserted **13 columns**; push inserted **19**.

| | PULL `/api/integration/pull` | PUSH `/api/integration/transport-requests` |
|---|---|---|
| Auth | ✅ `requireAuth` (4 staff roles) | service token **or** user session |
| Idempotency on `external_booking_id` | ✅ | ✅ (200 + `idempotent: true`) |
| Resolves `requested_vehicle_type` → category | ❌ | ✅ |
| `estimated_distance` / `estimated_duration` | ❌ | ✅ |
| `is_vip` / `is_emergency` | ❌ | ✅ |
| Assigns `reservation_number` | ❌ | ✅ |
| Writes `CREATED` timeline event | ❌ | ✅ |

> **Two rows of the original table were false.** It claimed pull had "none
> visible" auth and no idempotency check. Both were wrong: `requireAuth` was on
> line 18 and the `SELECT ... WHERE external_booking_id` guard was in the loop,
> in the same file the note cited as its source. It also **missed** three real
> divergences (the travel estimate and the two flags). The table was labelled
> CONFIRMED. → [[Mistakes I Made]], [[Things I Should Not Forget]]

A request arriving via pull therefore landed with no resolved category, no
travel estimate, no reservation number and **no timeline at all** — the row
existed but its history started empty.

## What was actually done

Extracted `ingestRequest(request, { session, actor, eventType })` into
`src/lib/integration/ingest.js`, running one sequence for both callers:
contract parse → idempotency check → `estimateTrip()` → `resolveVehicleCategory()`
→ the 19-column INSERT → `assignReservationNumber()` →
`recordReservationEvent(CREATED)` → `integration_log`.

**Four differences were kept deliberately**, because they are properties of the
door and not of the row:

1. **Auth** — pull is session-gated to staff; push accepts a service token.
2. **Error handling** — a malformed item in a pull batch is skipped and counted,
   so one bad record from Booking cannot block the good ones behind it. Push
   answers its sender a 400 instead. This is why the contract parse stays in the
   routes rather than inside `ingestRequest`.
3. **`event_type`** — `transport_request_pulled` vs `transport_request_received`,
   parameterized, so reconciliation can still tell push from pull.
4. **Audit shape** — pull writes one aggregate row per operator click; push
   writes one per request.

## Why it was not caught by the type system

There isn't one. The two INSERTs were separate string literals six directories
apart; nothing related them. The regression test now does: it asserts both doors
emit the **identical SQL string and identical params array**, which is the exact
property that was broken.

## Why it happened — INFERRED

Pull is the older polling design; push was added when the mock gateway gained
webhook semantics, and the enrichment steps were added to push only. The
repository does not document why the two were never reconciled.

## Related

[[System Boundaries]] · [[Reservations]] · [[Request Lifecycle]] · [[Technical Debt]] · [[Debugging Index]] · [[Mistakes I Made]]
