---
type: architecture
title: Data Flow
tags: [architecture, dataflow, diagram]
source:
  - src/app/api/integration/transport-requests/route.js
  - src/services/reservation-lifecycle.service.js
  - src/app/api/dispatch/route.js
  - src/app/api/trips/[id]/start/route.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-08-11
---

# Data Flow

The end-to-end path a single guest request takes. Each box names the **real file**.

## The main line — CONFIRMED

```mermaid
sequenceDiagram
    participant B as Booking/PMS
    participant API as /api/integration/transport-requests
    participant TR as transportation_requests
    participant D as Dispatcher (web)
    participant DS as dispatchschedules
    participant T as trips
    participant M as Driver (mobile)
    participant LOG as integration_log

    B->>API: POST TransportationRequestSchema
    API->>API: parseTransportationRequest() · normalizePriority()
    API->>API: resolve requested_vehicle_type → category_id
    API->>TR: INSERT status=Pending (idempotent on external_booking_id)
    API->>TR: reservation_events CREATED

    D->>TR: review → Under Review → Approved
    Note over D: advanceReservation() is the ONLY writer
    D->>DS: POST /api/dispatch {vehicle, driver, window}
    Note over DS: trg_dispatch_overlap fires BEFORE INSERT
    DS->>T: trip row created
    DS->>TR: status → Scheduled/Assigned
    API-->>LOG: emitTransportStatus(SCHEDULED)

    M->>T: POST /trips/:id/start (odometer)
    loop every 30s while foreground
        M->>T: POST /trips/:id/gps
    end
    M->>T: POST /trips/:id/complete (odometer)
    T->>TR: status → Completed
    API-->>LOG: emitTransportStatus(COMPLETED)
    LOG-->>B: outbound status event (best-effort)
```

## Where each piece of state lives — CONFIRMED

| Stage | Table | Written by |
|---|---|---|
| Request | `transportation_requests` (15 rows) | integration routes, then `advanceReservation` |
| Audit trail of the request | `reservation_events` (69 rows) | `reservation-lifecycle.service.js` |
| Resource booking | `dispatchschedules` (2 rows) | `/api/dispatch` |
| Execution | `trips` (2 rows) | trip routes |
| Live position | `trips` GPS columns | mobile every 30 s |
| Driver↔vehicle pairing | `driver_vehicle_assignments` | `withTransaction` |
| Outbound record | `integration_log` (149 rows) | `emitTransportStatus` |
| Everything security-relevant | `audit_logs` (226 rows) | `writeAudit()` |

## Three status vocabularies move in parallel — CONFIRMED

A single request has **three** simultaneous statuses:

```mermaid
flowchart LR
    R["transportation_requests.fleet_status<br/>9 values<br/>reservation-state.js"]
    DP["dispatchschedules.status<br/>5 values (033 declared the 5th)<br/>dispatch-state.js"]
    TP["trips.status<br/>13 values<br/>trip-state.js"]
    R -->|"advanceReservation()<br/>reservation-lifecycle.service.js"| DP
    DP -->|"ensureTripForDispatch()<br/>status.service.js"| TP
    TP -.->|"syncVehicleStatus / syncDriverStatus<br/>status.service.js"| V["vehicles.vehicle_status<br/>drivers.driver_status"]
```

They are **not** the same machine. Each has its own writer, and the coupling is
explicit calls rather than triggers — this is the single most confusing thing in
the codebase.

> **Corrected 2026-08-11.** This diagram used to name
> `syncDispatchReservation()` in `src/lib/scheduling/sync.js` as the thing keeping
> the statuses in sync. **That file has never existed** — `git log --all` and
> `find` both return nothing for it. The two real sync helpers live in
> `src/services/status.service.js`, and `syncDispatchReservation` itself was
> deleted in Phase 3 item 11 because it keyed on `reservation_id`, which was
> always NULL. See [[Mistakes I Made]] for why a plausible-looking path went
> unchecked for so long.

See [[Reservation State Machine]] · [[Dispatch State Machine]] · [[Trip State Machine]].

## Where the flow breaks today — CONFIRMED

| Break | Effect |
|---|---|
| Outbound gateway is a mock that throws | nothing reaches Booking — [[System Boundaries]] |

That is the whole list as of 2026-08-11, and it is the only one on it because the
gateway needs a `BOOKING_GATEWAY` credential rather than a code change.
→ [[Environment Setup]]

**Closed since this note was written:**

| Was breaking | Closed by |
|---|---|
| `/api/trips/[id]/start` line 67 threw undefined `AuthError` | import added, Phase 1 — [[BUG AuthError Not Imported]] |
| `'Pending Reassignment'` accepted by the DB, rejected by `dispatch-state.js` | migration 033 + an explicit `INTERRUPT` set, Phase 2 — [[BUG Pending Reassignment Not In State Machine]] |
| Sync helpers keyed on `reservation_id`; live rows use `request_id`, so the branch never fired | the helper, its 5 call sites and the table were **deleted** in Phase 3, migration 036 — [[DEBT vehiclereservations vs transportation_requests]] |
| The two ingest doors wrote 13 vs 19 columns — a pulled request landed with no category, estimate, reservation number or timeline | one shared `ingestRequest()` in `src/lib/integration/ingest.js`, Phase 3 — [[DEBT Ingest Paths Diverge]] |

## Auth is a separate flow

Neither `proxy.js` nor any layout guards the API. **Each of the 113 route handlers calls `requireAuth()` itself.** See [[Authentication]].

## Related

[[Architecture]] · [[System Boundaries]] · [[Request Lifecycle]] · [[Where Is This]] · [[Reservations]] · [[Dispatch]] · [[Trips]]
