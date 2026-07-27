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