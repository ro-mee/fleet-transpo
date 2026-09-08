---
type: feature
status: working
tags: [feature, routes, locations, tomtom, dispatch]
source:
  - src/app/(dashboard)/routes
  - src/app/api/routes
  - src/app/api/locations
  - src/app/api/tomtom/route
  - src/services/route-resolver.service.js
  - src/services/route.service.js
  - src/services/route-feasibility-context.service.js
  - src/lib/tomtom.js
  - src/lib/routing/route-cache.js
  - src/lib/scheduling/route-feasibility.js
  - supabase/migrations/076_routes_integrity.sql
last_verified: 2026-09-07
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

## Traffic-Aware Routing + Three-Leg Feasibility — PR #1 (2026-09-07)

`computeTravelTimeFor=all` was already in `buildRouteUrl()` and stays. PR #1 adds what was missing:

- **Traffic + planning params** (`src/lib/tomtom.js`): `traffic=true` by default, `departAt` (ISO-8601), `maxAlternatives` clamped 0–2. New `fetchTomTomRoute()` returns primary summary + geometry + guidance + alternative summaries; `parseRouteSummary()` surfaces `trafficDelayMin` (previously dropped by the proxy). `fetchTomTomEstimate()` keeps its signature and now includes `trafficDelayMin`.
- **Proxy** (`GET /api/tomtom/route`): accepts `departAt` + `alternatives`, returns `trafficDelayMin`, `noTrafficMinutes`, `alternatives[]`, `provenance: "live"`.
- **Short-TTL cache** (`src/lib/routing/route-cache.js`, 5 min, rounded coords + 10-min departure buckets). This makes the "server-side caching" claim above real — previously every call was a live fetch.
- **Pure feasibility engine** (`src/lib/scheduling/route-feasibility.js`): `evaluateRouteFeasibility({now, pickupAt, deadheadMinutes, passengerMinutes, nextPickupAt, repositionMinutes, safetyBufferMinutes})` → `requiredDeparture / pickupBufferMin / expectedArrival / turnaroundMin / verdict (SAFE|TIGHT|INFEASIBLE|UNKNOWN) / reasons[]`. No DB, no fetch, `now` passed in. Null legs → `UNKNOWN` (fail-open).
- **I/O context builder** (`src/services/route-feasibility-context.service.js`): deadhead via cached live route → haversine fallback; passenger leg preserves snapshot → live → legacy priority; next booking = next `Scheduled`/`In Progress` dispatch for the vehicle/driver (pending queue requests are NOT next bookings — Phase 2). Provenance contract: `live|cached|snapshot|fallback|unknown`.
- **Two-stage costing**: recommendation enriches only the nearest-5 Haversine shortlist with `_deadhead_minutes_routed` / `_deadhead_provenance`. Scoring untouched (Phase 2). Routing matrix noted as future evolution.
- **Verified**: `route-feasibility.test.js` (8 tests incl. 8:15→9:00→11:00 acceptance: buffer 16, arrival 9:42, turnaround 53 → SAFE; 38-min deadhead → INFEASIBLE "departed 3 min ago"), `route-cache.test.js`, extended `tomtom.test.js`. Full suite 654 passing, eslint clean.

## Route Feasibility Card — PR #2 (2026-09-07)

The engine is now dispatcher-visible. The recommendation endpoint attaches a `feasibility` object to recommended + alternate + top-3 candidates (`attachPairFeasibility`, deduped, capped at 5 computations, fail-open per pair, scoring untouched):

- Per-pair verdict (`SAFE|TIGHT|INFEASIBLE|UNKNOWN`) with required departure, pickup buffer, passenger journey, expected arrival, next assigned pickup, reposition travel, turnaround, `reasons[]`, and per-leg provenance.
- Deadhead reuses the shortlist's routed minutes; passenger minutes come from the already-resolved trip estimate (no second live call); driver position coordinates now ride on candidate rows (`_position_lat/_position_lng`).
- The panel (`AiRecommendationPanel` → `FeasibilityBlock`) renders the card for the shown pair with a verdict chip and provenance labels; pairs beyond the computed set simply show no card. Skipped vehicles are disclosed in a collapsible "Why N other vehicles didn't qualify" list even when pairs exist.
- Override reasons: the assign endpoint accepts `override_reason` (≤500 chars, stored in timeline metadata alongside `overridden_conflicts[]`); the panel shows a reason input whenever the Override & Accept path is visible. Optional, not blocking.
- Verified: `route-feasibility-context.test.js` (5 tests: provenance labels, SAFE pair shape, UNKNOWN fail-open, top-set attachment, empty passthrough). Full suite 659 passing, eslint clean.

## Arrival Geofences — PR #3 (2026-09-08)

Migration `108_location_geofence_radii.sql` (applied via `db:up`, verified live, `schema.sql` dumped): `locations.pickup_radius_m/dropoff_radius_m` (NOT NULL DEFAULT 100, `chk_locations_geofence_radii` 1–1000 m), tuned to Hotel pickup 60 / arrivals pickup 150 / departures dropoff 120; `trips.gps_distance_km` added.

- **Pure engine** (`src/lib/geo/geofence.js`): `evaluateGeofence` (inside/outside/unknown + distance), `evaluateTripGeofences` (both ends), accuracy guard (>150 m → UNKNOWN, stored but never an arrival claim), `trailDistanceKm` (180 km/h teleport filter). Radii sanitize to default, never 0/infinity.
- **Targets** (`src/services/trip-geofence.service.js`): canonical location (coords + radii) → gazetteer → null, 5-min cache; `evaluatePingGeofence` enriches every ingested GPS POST with `near_pickup/near_destination/distances/state`; `checkDestinationProximity` gates completion from the server's latest ping (10-min freshness, fail-open).
- **Never auto-transitions**: arrival prompts are suggestions; the driver confirms via at-pickup/dropoff/complete as before.
- Locations API GET/POST/PUT carry the radii (in-place only — radii never trigger coordinate versioning).
- Verified: `geofence.test.js` (12), `trip-geofence.test.js` (7). Full suite 678 passing, eslint + build clean.

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
