---
type: feature
status: working
tags: [feature, routes, locations, tomtom, dispatch]
source:
  - src/app/(dashboard)/routes
  - src/app/api/routes
  - src/app/api/locations
  - src/services/route-resolver.service.js
  - src/services/route.service.js
  - supabase/migrations/076_routes_integrity.sql
last_verified: 2026-08-31
related: ["[[Dispatch]]", "[[Trips]]", "[[Reservations]]"]
---

# Feature: Canonical Directional Routes & Location Identity

## What it does

The **Routes Registry** (`/routes`) manages verified directional transit pairs (`Origin → Destination`) between canonical physical locations stored in the `locations` table.

It serves as the single source of truth for:
- Standard travel distance (`estimated_distance` in km) and duration (`estimated_duration` in minutes).
- Automatic TomTom turn-by-turn routing and ETA calculations.
- Reservation request routing during guest intake and automatic dispatch creation.
- Mobile driver turn-by-turn navigation data.

---

## Canonical Location Architecture (Migrations 076–080)

Prior to migration `076`, routes stored arbitrary origin and destination text strings, leading to duplicate names, mismatched coordinates, and broken turn-by-turn navigation. The system now enforces **location-first relational integrity**:

1. **Relational Foreign Keys**:
   - `routes.origin_location_id` $\rightarrow$ `locations(location_id)`
   - `routes.destination_location_id` $\rightarrow$ `locations(location_id)`
   - Unique constraint on `(origin_location_id, destination_location_id)`.
2. **Directional Arrow Normalization (`079_normalize_route_arrows.sql`)**:
   - All bidirectional route strings (e.g. `Hotel ↔ NAIA`) are normalized to unidirectional directional arrows (`Hotel → NAIA Terminal 3`).
   - Reverse journeys are explicitly modeled as distinct, separate route records.
3. **Hotel Identity Preservation (`080_backfill_hotel_location_identity.sql`)**:
   - The primary hotel identity retains a stable `location_id`. Renaming the hotel updates its name in place.
   - Physical relocations version and retire the old identity so that historical dispatches and trips retain their original geographic accuracy.

---

## Route Lifecycle & Integrity Rules

- **Pre-Use Flexibility**: Unused routes can be edited (name, endpoints, distance, duration) or deleted/archived.
- **Post-Use Immutability Lock**: Once a route is referenced by at least one historical dispatch or trip, its endpoint locations (`origin_location_id`, `destination_location_id`) are **locked**. If a physical path changes, operators must deactivate the legacy route and create a new active route record.
- **Deactivation vs Archival**: Historical routes are marked `status = 'Inactive'` rather than deleted, preserving audit trails and reporting integrity.

---

## Route Resolver Service (`src/services/route-resolver.service.js`)

Centralized service used across booking ingestion, dispatch auto-creation, rescheduling, and AI dispatch recommendations:
- Resolves best-matching canonical routes from raw guest pickup/dropoff text or coordinates.
- Calculates automated TomTom distance and duration metrics with server-side caching.
- If endpoints lack verified GPS coordinates, navigation gracefully omits route lines and ETAs rather than guessing fictitious paths.

---

## Management UX (`src/app/(dashboard)/routes/page.js`)

- **KPI Metric Cards (`StatGrid` + `StatCard`)**:
  - **Active Routes**: Count and percentage of total registry ready for dispatching.
  - **Navigation Ready**: Routes with both origin & destination GPS coordinates verified.
  - **Needs Setup**: Routes missing coordinates with warnings on routing impact.
  - **Recent Activity**: 30-day utilization volume against active routes.
- **Inline Location Creation**: Operators can add new canonical locations with address and coordinate validation directly inside the route creation flow.
- **TomTom Recalculation**: One-click recalculation triggers live TomTom routing queries to refresh distance and travel time estimates.

---

## Related

[[Dispatch]] · [[Trips]] · [[Reservations]] · [[Database Overview]] · [[Feature Index]]
