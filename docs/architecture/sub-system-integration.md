# Fleet Management Sub-System: Integration Architecture

## 1. System Boundary

The fleet management system operates as a **sub-system** within a larger hotel and restaurant operation. It does **not** own guest, room, or billing data — those reside in the parent systems (PMS, POS, Booking Engine).

```
┌─────────────────────────────────────────────────────────────────┐
│                    HOTEL / RESTAURANT ECOSYSTEM                  │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐             │
│  │    PMS      │  │    POS      │  │  Booking     │             │
│  │ (Hotel)     │  │ (Restaurant)│  │  Engine      │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘             │
│         │               │               │                        │
│         └───────────────┴───────────────┘                        │
│                         │                                        │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              FLEET SUB-SYSTEM (Your System)              │   │
│  │                                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  │   │
│  │  │Vehicles  │  │ Drivers  │  │ Routes │  │ Dispatch │  │   │
│  │  └──────────┘  └──────────┘  └────────┘  └──────────┘  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  │   │
│  │  │Reservntns│  │ Trips    │  │ Fuel   │  │Maintenanc│  │   │
│  │  └──────────┘  └──────────┘  └────────┘  └──────────┘  │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │           Integration Layer                      │   │   │
│  │  │  service_types · booking_channels · integ_log    │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Data Ownership Matrix

| Data Domain | Owned By | Fleet Sub-System Action |
|-------------|----------|------------------------|
| Guests | Parent System (PMS) | Reference via `external_booking_id` + `guest_id` |
| Rooms | Parent System (PMS) | Reference via `room_number` |
| Bookings | Parent System (PMS/POS) | Reference via `external_booking_id` |
| Billing/Charges | Parent System (PMS) | Flag via `bill_to_room` — parent posts the charge |
| Menu/Orders | Parent System (POS) | Reference via `external_booking_id` |
| **Vehicles** | **Fleet System** | Full CRUD |
| **Drivers** | **Fleet System** | Full CRUD |
| **Routes** | **Fleet System** | Full CRUD |
| **Trips** | **Fleet System** | Full CRUD |
| **Fuel Records** | **Fleet System** | Full CRUD |
| **Maintenance** | **Fleet System** | Full CRUD |

## 3. Database Schema (Fleet Sub-System Only)

### 3.1 Core Fleet Tables

All tables from `001_schema.sql` remain. The following additions in `004_integration_sub_system.sql` enable sub-system operation.

### 3.2 New Tables

#### `service_types`

Defines what kind of fleet service is being requested. This is fleet-specific — the parent system doesn't know or care about vehicle categories.

```
service_types
├── service_type_id (PK, SERIAL)
├── service_name            VARCHAR(100) NOT NULL  -- e.g. "Airport Transfer"
├── description             TEXT
├── requires_vehicle        BOOLEAN DEFAULT TRUE
├── requires_driver         BOOLEAN DEFAULT TRUE
├── default_category_id (FK → vehiclecategories)
├── icon                    VARCHAR(50)
├── color                   VARCHAR(20)
├── sort_order              INT DEFAULT 0
├── status                  VARCHAR(50) DEFAULT 'Active'
├── created_at              TIMESTAMPTZ
├── updated_at              TIMESTAMPTZ
└── deleted_at              TIMESTAMPTZ
```

Seed values: Airport Transfer, City Tour, Hotel Shuttle, Point-to-Point, Food Delivery, Staff Transport, Supply Run, Event Transport, Valet Service.

#### `booking_channels`

Where the booking originated in the parent system. This helps track which department/concierge/source generates the most fleet demand.

```
booking_channels
├── channel_id (PK, SERIAL)
├── channel_name            VARCHAR(100) NOT NULL
├── source_system           VARCHAR(50)  -- "PMS", "POS", etc.
├── description             TEXT
├── status                  VARCHAR(50) DEFAULT 'Active'
└── created_at              TIMESTAMPTZ
```

Seed values: Front Desk, Concierge, Restaurant POS, Online Booking, Phone, Walk-in.

#### `integration_log`

Audit trail for all communication between fleet sub-system and parent system. Enables debugging, replay, and monitoring of integration health.

```
integration_log
├── log_id (PK, BIGSERIAL)
├── direction               VARCHAR(20) NOT NULL  -- 'inbound' | 'outbound'
├── source_system           VARCHAR(50) NOT NULL
├── event_type              VARCHAR(100) NOT NULL  -- 'booking_created', 'booking_cancelled', etc.
├── reference_type          VARCHAR(100)           -- 'reservation', 'dispatch'
├── reference_id            INT
├── external_booking_id     VARCHAR(255)
├── payload                 JSONB                  -- full request/response data
├── status                  VARCHAR(50) DEFAULT 'pending'
│                           -- 'pending' | 'processed' | 'failed' | 'skipped'
├── error_message           TEXT
├── processed_at            TIMESTAMPTZ
└── created_at              TIMESTAMPTZ
```

### 3.3 Modified Table: `vehiclereservations`

> **Superseded — see §8.** This table is a legacy FK target. `transportation_requests`
> is the reservation entity; 015 deprecates the guest columns below as
> Booking-mastered, and no UI reads this table. It is retained only because 015 and
> `dispatchschedules` still hold FKs to it.

New columns added to link reservations to external bookings without duplicating parent system data:

| Column | Type | Purpose |
|--------|------|---------|
| `service_type_id` | FK → `service_types` | What kind of fleet service |
| `external_booking_id` | VARCHAR(255) | Reference ID from parent system |
| `integration_source` | VARCHAR(50) | Which parent system (PMS, POS, etc.) |
| `booking_channel_id` | FK → `booking_channels` | Where the booking originated |
| `guest_id` | VARCHAR(100) | Guest ID from parent (denormalized reference) |
| `room_number` | VARCHAR(20) | Hotel room (denormalized for quick lookup) |
| `bill_to_room` | BOOLEAN | Whether to post charge to room bill |
| `cancellation_reason` | TEXT | Why the reservation was cancelled |

Existing guest fields (`guest_name`, `guest_phone`, `guest_email`) are kept as **denormalized cache** — they mirror parent system data for quick display without requiring an API call to the parent.

## 4. Integration Flow

### 4.1 Inbound: Parent System → Fleet

```
Parent System (PMS/POS)
       │
       │ 1. Guest books transport via Front Desk / Concierge / POS
       ▼
[integration_log] ── direction='inbound', status='pending'
       │
       │ 2. processInboundBooking() creates a vehiclereservations row
       ▼
[integration_log] ── status='processed'
       │
       │ 3. Fleet system manages dispatch, trip, etc.
       ▼
    Complete
```

### 4.2 Outbound: Fleet → Parent System

```
Fleet Reservation Status Change
       │
       │ 1. Reservation approved, dispatched, completed
       ▼
[integration_log] ── direction='outbound', status='processed'
       │
       │ 2. Parent system can poll or listen for status updates
       ▼
  Parent System updates its booking record
```

### 4.3 Reservation Lifecycle (with Integration)

```
    ┌──────────┐
    │  Pending │ ← Created by parent system or staff
    └────┬─────┘
         │ Approve
    ┌────▼─────┐
    │ Approved │ → Log outbound to parent
    └────┬─────┘
         │ Create Dispatch
    ┌────▼──────┐
    │ Dispatched│ → Log outbound to parent
    └────┬──────┘
         │ Driver accepts, starts trip
    ┌────▼─────┐
    │ In Progress│
    └────┬─────┘
         │ Complete
    ┌────▼──────┐
    │ Completed │ → Log outbound to parent (for billing)
    └───────────┘
```

## 5. API Integration Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integration/inbound` | POST | Accept booking from parent system |
| `/api/integration/status` | GET | Check integration health |
| `/api/integration/logs` | GET | Query integration log |
| `/api/integration/retry/:logId` | POST | Retry failed integration event |

## 6. Security Considerations

- Integration logs contain sensitive guest data — RLS restricts to admin only
- External booking IDs should be validated to prevent injection
- Parent system calls should use an API key (not user session) for machine-to-machine communication
- Integration events are idempotent — processing the same event twice should not create duplicate reservations

## 7. ERD Legend

```
TABLE_NAME
├── column (PK)    ← Primary Key
├── column (FK)    ← Foreign Key (referenced table)
├── column         ← Regular column
└── ...            ← Additional columns

Relationships:
   1 ─── *    One to Many
   * ─── *    Many to Many (junction table)
   ─── 1      One to One
```

---

## 8. Transportation Request Integration (current)

> Sections 1–7 describe the original `vehiclereservations`-based integration and
> are kept for history. This section describes the **current** Booking → Fleet
> transportation-request flow (migrations `015_transportation_requests.sql` and
> `016_reservation_module.sql`, plus the `/api/integration` surface). It is the
> authoritative reference for how Fleet consumes work from the Booking subsystem
> today.
>
> **`transportation_requests` IS the reservation.** `vehiclereservations` is
> demoted to a legacy FK target — 015 and `dispatchschedules` still reference it,
> so it is not dropped, but nothing new is written there and no UI reads it. The
> `/reservations` register, the `/reservations/queue` workspace, both detail pages,
> the dispatch board, and `/dispatch/calendar` all read `transportation_requests`.

### 8.1 Ownership: Fleet never authors bookings

The **Booking subsystem** (a sibling of Fleet inside the Hotel Management
System) is the system of record for the guest side of a transport request:

| Field | Owner | Fleet access |
|-------|-------|--------------|
| Guest info / name | Booking | read-only (denormalized) |
| Booking number / reference | Booking | read-only |
| Room number / hotel branch | Booking | read-only |
| Pickup & drop-off location | Booking | read-only |
| Pickup date/time | Booking | read-only |
| Guest / passenger count | Booking | read-only |
| Special requests | Booking | read-only |
| Approval status (guest-side) | Booking | read-only |
| **`fleet_status` (lifecycle)** | **Fleet** | **read/write** |
| Vehicle / driver assignment | Fleet | read/write |
| Dispatch / trip | Fleet | read/write |

Fleet **consumes** transportation requests; it **never creates hotel
reservations**. It owns only `fleet_status` and everything downstream of it
(dispatch, trip, completion). Booking data arrives denormalized on the
`transportation_requests` row and is treated as a read-only cache — the system
of record stays in Booking.

Fleet also does **not** open a direct database connection to Booking. All
exchange goes through the anti-corruption gateway over the API boundary
(`src/lib/integration/booking-gateway.js`), so Booking's schema can change
without touching Fleet.

### 8.2 The `fleet_status` lifecycle

**Nine** statuses (migration `016_reservation_module.sql`). The single authority on
legal transitions is `src/lib/scheduling/reservation-state.js`
(`canTransitionReservation`); the DB `chk_transport_fleet_status` CHECK and
`RESERVATION_LIFECYCLE` in `src/lib/constants.js` mirror the same vocabulary.
016 retired the 015 spellings: `Waiting for Fleet Review → Under Review`, and the
split `Driver Assigned` / `Vehicle Assigned` collapsed into one `Assigned`.

```
  Pending                     (fresh ingest, not yet claimed)
     │
     ▼
  Under Review                (a dispatcher has claimed it)
     │
     ├──────────────► Rejected      (terminal) ─► notify Booking
     │
     ▼
  Approved                    (dispatchable) ─► notify Booking
     │
     ▼
  Scheduled                   (dispatch raised)
     │
     ▼
  Assigned                    (vehicle AND driver committed) ─► notify Booking
     │
     ▼
  In Progress                 (trip started) ─► notify Booking
     │
     ▼
  Completed                   (terminal) ─► notify Booking

  Cancelled                   (terminal, reachable from any non-terminal state)
```

The chain is strictly linear — no jumps. A multi-step operator action walks it one
validated, logged hop at a time via `transitionPath()`: dispatching an approved
request with both a vehicle and a driver executes `Approved → Scheduled → Assigned`
as two transitions, not one leap, so the timeline shows both.

`In Progress` is no longer aspirational. `PUT /api/trips/[id]/start` advances the
request into it and `…/complete` closes it out, which is what makes the state
reachable — before 016 nothing wrote it.

**Reschedule is not a lifecycle step.** Moving `pickup_datetime` is a property
change: it writes a `rescheduled` event and leaves `fleet_status` where it was.

### 8.3 End-to-end flow

```
Booking subsystem
     │  webhook: POST /api/integration/transport-requests
     │  (or poller: POST /api/integration/pull)
     ▼
[transportation_requests]  fleet_status = Pending
[reservation_events]       created
[integration_log]          direction='inbound', status='processed'
     │
     │  Dispatcher works the queue at /reservations/queue
     ├── Start Review ─► PUT …/[id]/review ─► Under Review
     │      │
     │      ├── Reject ─► PUT …/[id]/reject ─► Rejected  (terminal) ─► emit → Booking
     │      │
     │      └── Approve ─► PUT …/[id]/approve ─► Approved ─► emit → Booking
     │             │
     │             │  Commit resources. AI advises; a human always confirms.
     │             ▼
     │         PUT …/[id]/assign   {vehicle_id, driver_id}
     │             │   Approved → Scheduled → Assigned (two logged hops)
     │             │   blocking conflicts → 409 unless {force:true},
     │             │   which is recorded on the timeline as an override
     │             ▼
     │         POST /api/dispatch  (gated: request must be Approved/Scheduled/
     │             │   Assigned; 409 otherwise)
     │             │   dispatchschedules.request_id ← request
     │             ▼
     │         Trip generated (ensureTripForDispatch)
     │             │
     │             ├─► PUT /api/trips/[id]/start
     │             │      fleet_status = In Progress ─► emit → Booking
     │             │
     │             └─► PUT /api/trips/[id]/complete
     │                    trip → dispatch → request  (join on request_id,
     │                    falling back to reservation_id for legacy rows)
     │                    fleet_status = Completed ─► emit → Booking
     │                        │
     │                        ▼
     │                    Booking updates its record (e.g. for billing)
     │
     └── Cancel ─► PUT …/[id]/cancel ─► Cancelled (from any non-terminal state)
```

Every hop appends a row to `reservation_events` via `recordReservationEvent()` —
the single writer — which is what the Phase 15 timeline renders on both the
reservation and dispatch detail pages. The log is append-only and written
best-effort: a logging failure never rolls back the transition that succeeded.

Every outbound status change is delivered through the gateway and recorded in
`integration_log` (`direction='outbound'`). Delivery is **best-effort**: a sync
failure is logged (`status='failed'`) but never rolls back the Fleet operation
that triggered it, so a future reconciliation job can retry from the log.

One outbound row is emitted per **operator action**, not per internal hop. The
two-hop assign (`Approved → Scheduled → Assigned`) emits once, because both Fleet
states map to the same external `SCHEDULED` (§8.2, `FLEET_TO_EXTERNAL`) — a second
delivery would tell Booking nothing new. The internal granularity is preserved in
`reservation_events`, which is where per-hop history belongs.

### 8.4 Idempotency

Inbound ingest is keyed on `external_booking_id`. Re-delivering the same
Booking event does not create a duplicate request — the second POST returns the
existing row (`idempotent: true`) instead of inserting. This makes webhook
retries and poller overlap safe.

### 8.5 API surface (current)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integration/transport-requests` | GET | List the queue. Joins vehicle/driver/category; supports search + the Phase 12 filters; `?with_conflicts=true` attaches advisory findings (batched, not N+1) |
| `/api/integration/transport-requests` | POST | Ingest a Booking request (webhook, idempotent) |
| `/api/integration/transport-requests/[id]` | GET | One request + its dispatches, resolved reviewer/approver names, and advisory conflicts — what the detail page loads |
| `/api/integration/transport-requests/[id]/review` | PUT | Claim it: Pending → Under Review |
| `/api/integration/transport-requests/[id]/approve` | PUT | Approve → dispatchable |
| `/api/integration/transport-requests/[id]/reject` | PUT | Reject (records reason) |
| `/api/integration/transport-requests/[id]/assign` | PUT | Commit vehicle and/or driver; 409 on blocking conflict unless `{force:true}` |
| `/api/integration/transport-requests/[id]/cancel` | PUT | Cancel from any non-terminal state (records reason) |
| `/api/integration/transport-requests/[id]/reschedule` | PUT | Move `pickup_datetime`; does not change `fleet_status` |
| `/api/integration/transport-requests/[id]/timeline` | GET | The append-only `reservation_events` log |
| `/api/integration/transport-requests/[id]/recommendation` | GET / POST | AI advisor. GET previews and writes nothing; POST caches the result onto the request. **Neither assigns** |
| `/api/integration/pull` | POST | Poll the gateway for new requests (mock in dev) |
| `/api/integration/inbound` · `/outbound` · `/logs` | — | Integration-log surfaces |

Read access is deliberately wider than write access: the list and detail GETs also
admit `management`, `reception_staff`, and `concierge`, because front-of-house gets
asked "where is the guest's car?". Every mutating endpoint narrows to the
dispatcher set (`system_admin`, `admin`, `fleet_manager`, `dispatcher`) via
`requireAuth`, matching the `can("reservations", …)` gates the UI uses to hide the
same actions. The server check is the boundary; the client gate is only chrome.

### 8.6 The event log (`reservation_events`)

Append-only history for one request, created by 016. `recordReservationEvent()` in
`src/services/reservation-events.service.js` is the **single writer**; the 16 event
types are `RESERVATION_EVENT` in `src/lib/constants.js`.

```
reservation_events
├── event_id      BIGSERIAL PK
├── request_id    FK → transportation_requests  ON DELETE CASCADE
├── event_type    VARCHAR(50) NOT NULL   -- created, reviewed, approved, …
├── from_status   VARCHAR(50)            -- null for non-transition events
├── to_status     VARCHAR(50)
├── actor_id      FK → employees         -- null for machine/gateway actions
├── actor_role    VARCHAR(50)
├── description   TEXT
├── metadata      JSONB                  -- e.g. the forced-override record
└── occurred_at   TIMESTAMPTZ DEFAULT NOW()
```

Indexed on `(request_id, occurred_at)` — the timeline's only access pattern. Why it
exists: the pre-016 pages wrote `status` directly, so "who approved this and when"
was unanswerable. Routing every action through the lifecycle endpoints is what keeps
this log complete; a direct status write is now a bug, because it produces a state
change with no history.

### 8.7 Conflict detection

`detectRequestConflicts(request)` in `src/lib/scheduling/conflicts.js` returns typed
findings: `vehicle_conflict`, `driver_conflict`, `maintenance_conflict`,
`driver_unavailable`, `license_expired`, `registration_expired`,
`capacity_mismatch`. The queue renders them as chips; the detail page lists them.

Everywhere except `assign`, conflicts are **advisory** — a detection failure returns
an empty findings list rather than 500-ing the page. `PUT …/[id]/assign` is the
enforcement point: a blocking finding returns 409, and `{force:true}` is the
documented override, recorded on the timeline so the decision is attributable.

The overlap rule is defined **once** and shared three ways: the SQL in
`findDispatchConflicts`, `overlapsWindow()` server-side, and `overlaps()` in
`src/lib/scheduling/calendar.js` for the browser. All three are half-open
(`startA < endB && endA > startB`), which is what makes back-to-back trips legal —
a 09:00–10:00 and a 10:00–11:00 do not collide. If they ever disagree the calendar
either cries wolf or hides a real double-booking, so
`scripts/verify-calendar.mjs` pins the rule.

`src/lib/scheduling/calendar.js` imports only `date-fns` — never `lib/db` — because
it is pulled into `"use client"` components.

### 8.8 AI advisor

`src/lib/ai/dispatch-advisor.js` extends the deterministic `rule-engine.js` scorers
into the Phase 14 payload: a top pick with confidence and reasons, estimated fuel
and travel minutes, detected risks, and one alternate each. The optional LLM
narration is a nullable add-on; the ranking itself is rule-based and explainable.

**The advisor never writes an assignment.** GET previews without persisting; POST
caches the payload onto `ai_vehicle_recommendation` / `ai_driver_recommendation` so
the queue can badge a request without re-scoring. Accepting a recommendation calls
the assign endpoint like any manual assignment — a human always confirms.

### 8.9 UI surface

| Route | Role |
|-------|------|
| `/reservations` | The register: every request in every state, dense, sortable, exportable. Read-only — actions live where the lifecycle endpoints and timeline are |
| `/reservations/queue` | The dispatcher's workspace: cards, priority badges, conflict + AI chips, search and six filters, auto-refresh |
| `/reservations/[id]` | One request: lifecycle bar, guest/booking, assignment, dispatches, advisor, timeline |
| `/reservations/new` | Dev-only mock injector (§8.10) — not a booking form |
| `/dispatch` | The board: dense cards, trip progress, `can()`-gated actions |
| `/dispatch/[id]` | One dispatch: journey, guest, trip record, and the request's timeline |
| `/dispatch/calendar` | Day/week/month + vehicle/driver lanes, highlighting double bookings, maintenance windows, driver leave, and vehicle downtime |

Start and Complete always go through the **trip** endpoints, never
`PUT /api/dispatch/[id]/status`. Only the trip routes advance the originating
request and write its event; moving the dispatch column alone would leave the
request behind and punch a hole in the timeline.

### 8.10 Configuration

| Var | Purpose |
|-----|---------|
| `BOOKING_GATEWAY` | `mock` (default) or `http` — selects the adapter |
| `NEXT_PUBLIC_BOOKING_GATEWAY` | client mirror; hides the dev mock-injector page when `http` |
| `BOOKING_WEBHOOK_SECRET` | bearer secret Booking sends on inbound webhooks |
| `BOOKING_API_URL` / `BOOKING_API_KEY` | live Booking API (only when `BOOKING_GATEWAY=http`) |

### 8.11 Dev-only mock injector

`/reservations/new` is **not** a reservation form. Fleet never authors guest
bookings, so that page is a developer tool that pushes a Booking-shaped payload
(matching `TransportationRequestSchema` in `src/lib/integration/contracts.js`)
through the same inbound boundary a real webhook uses. It hides itself when
`NEXT_PUBLIC_BOOKING_GATEWAY=http`. Mock payloads are shaped **exactly** like
future live API responses, so nothing downstream changes when the real gateway
is connected.