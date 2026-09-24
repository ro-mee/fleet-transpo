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

**2026-09-24 — the resolver now seeds from the request's durable link.** Both `resolveRouteForRequest` and `resolveRequestEstimate` pass `request?.pickup_location_id ?? request?.origin_location_id` (and the drop-off equivalent) with `allowNameFallback: true`. Until then the ID seed was unreachable: `origin_location_id`/`destination_location_id` exist only on `routes`, so passing `request?.origin_location_id` resolved to `undefined` for every request-shaped object and *all* resolution was name-only.

`allowNameFallback` is what decides what an ID **means**, and the default (`false`) is today's behaviour, so `/api/routes`, the dispatch radar and travel signals are untouched — there an ID is the sole authority, because a name fallback would let route creation match a location the caller did not name. A request turns it on, because a link can outlive what it points at: a physical move retires the old location and creates a new one, and without the fallback a stale link would resolve *worse* than no link at all. The link is preferred; the stored text is the fallback. See [[Reservations]].

`resolveRouteEndpoints` had no unit test before this — it was only ever mocked. It now has `src/services/route-resolver.test.js`, which pins the default-behaviour output and the fallback rules.

---

## Traffic-Aware Routing + Three-Leg Feasibility — PR #1 (2026-09-07)

`computeTravelTimeFor=all` was already in `buildRouteUrl()` and stays. PR #1 adds what was missing:

- **Traffic + planning params** (`src/lib/tomtom.js`): `traffic=true` by default, `departAt` (ISO-8601), `maxAlternatives` clamped 0–2. New `fetchTomTomRoute()` returns primary summary + geometry + guidance + alternative summaries; `parseRouteSummary()` surfaces `trafficDelayMin` (previously dropped by the proxy). `fetchTomTomEstimate()` keeps its signature and now includes `trafficDelayMin`.
- **Proxy** (`GET /api/tomtom/route`): accepts `departAt` + `alternatives`, returns `trafficDelayMin`, `noTrafficMinutes`, `alternatives[]`, `provenance: "live"`.
- **Short-TTL cache** (`src/lib/routing/route-cache.js`, 5 min, rounded coords + 10-min departure buckets). This makes the "server-side caching" claim above real — previously every call was a live fetch.
- **Pure feasibility engine** (`src/lib/scheduling/route-feasibility.js`): `evaluateRouteFeasibility({now, pickupAt, deadheadMinutes, passengerMinutes, nextPickupAt, repositionMinutes, safetyBufferMinutes, deadheadRequired=true})` → `requiredDeparture / pickupBufferMin / expectedArrival / turnaroundMin / verdict (SAFE|TIGHT|INFEASIBLE|UNKNOWN) / reasons[] / unknownLegs[]`. No DB, no fetch, `now` passed in. **2026-09-15 materiality rule:** a required null leg → `UNKNOWN` (fail-open), but the deadhead leg is only required when the journey has a known start (preceding destination or live position) — a scheduled pair with no preceding commitment is judged on the static legs, so no adjacent trips + known trip length → `SAFE` ("No adjacent trips constrain this assignment"), not a warning. `unknownLegs[]` names the missing leg for specific follow-up.
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
  > **2026-09-24 — the address is now picked, not typed; `locations.address_id` is written.** The canonical-location dialog at `src/app/(dashboard)/routes/locations/page.js` no longer has a free-text Address input. It shows the location's address read-only with a **Pick address** button that opens `AddressFormDialog` (the Region → Province → City/Municipality → Barangay cascade), and the picked value is posted as `structured_address`. The API resolves it server-side, composes `formatted_address` from **its own** resolution of the barangay code, and writes both the `addresses` row and `locations.address_id` in one transaction ([[addresses]]).
  >
  > **The pin stayed here, and that is deliberate.** `AddressFormDialog` is mounted with `showPinMap={false}`: the location already owns a coordinate (the Google Maps link / manual fields below it), and giving the address its own pin would mean two coordinate pairs for one place to keep in step. One point, one owner — see [[ADR-015 Address Owns Administration, Location Owns The Point]]. `showTypeSelector` is also false — home/office/**operational**/other is a choice about what a *place* is, and a canonical location is one thing, so the dialog applies `forcedType="operational"` to every save rather than offering a choice that would invite "home" for a hotel.
  >
  > **`operational` is also what stops the form demanding a house number.** It is the one address type that does not require `houseBuildingNumber` (`requiredDetailFields` in `src/lib/address/structured.js`) — a terminal curb has a road and a ZIP and no number, and requiring one leaves the operator to invent a number or leave the address unrecorded. The street and the ZIP stay required, and no personal address is affected. The dialog applies the forced type for the **whole lifetime of the form**, not only at submit: validating against the unforced `home` would demand a house number the server never asks for, leaving Save disabled with nothing to type.
  >
  > `locations.address` / `latitude` / `longitude` remain a **maintained denormalization** (the same shape `routes.origin` has against `origin_location_id`, 076) so geofence evaluation and the route resolver gain no join. The PUT carries `address_id` across the coordinate-change versioning branch, and **clears** it when a legacy string address is edited to a different string — the registry row describes the text it was resolved from, so keeping the pointer would have it describe an address that no longer says that.
  >
  > **2026-09-24 — the hotel base location moved too.** `src/app/(dashboard)/settings/general/page.js` now shows the hotel address read-only with a *Pick address* / *Replace address* button, and `PUT /api/settings/hotel` resolves the pick the same way. Three differences, all from what that surface *is* rather than from the address layer: the address is stored in **two** places (`locations` **and** the `system_settings` JSON blob), so `address_id` is written to both in one transaction; the `physical_move` flag chooses between UPDATE-in-place and INSERT-then-retire, and `address_id` is threaded through **both** branches; and because it is a whole-form PUT that always sends every field, the omitted-vs-empty rule below does **not** apply there — a missing address is a missing field, not an instruction to leave the stored one alone. The hotel keeps its own Latitude/Longitude fields and its Google Maps link.
  >
  > **2026-09-24 — the last two address surfaces moved too, and they are the first to keep the pin.** Driver residential and driver emergency contact are migrated: `/drivers/new` and `/drivers/[id]/edit` mount the same `AddressPickerField` and post `structured_address` / `emergency_structured_address`, which `POST`/`PUT /api/drivers` resolve into `drivers.address_id` / `drivers.emergency_contact_address_id`. Two differences from the surfaces above, both from what a person's home *is*: the pin map is **enabled**, because a driver's home has no other coordinate owner — `drivers` carries live and standby positions, never a residential one — so this is the first surface to exercise `chk_addresses_coords_pair`'s both-present branch rather than only its NULL half; and the composed address is **mirrored** into the legacy `drivers.address` / `emergency_contact_address` text columns, so every existing reader (the driver detail page included) is unchanged. `address_type` is forced to `home` there, the mirror image of `operational` on this surface. See [[Driver Management]] and [[addresses]].
  >
  > **Reservations is not an address surface.** Its pickup/drop-off are text naming a canonical location, and it reaches a structured address **through** that location via `linkRequestLocations()` (see the request → location link in [[Reservations]]).
  >
  > **The Google Maps URL paste path now survives on two surfaces, not four.** The canonical-location dialog (`locations.maps_url`) and the hotel settings (`system_settings.google_maps_url`) keep it; the driver surface never had one and still does not — a home has no location coordinate to paste over, and gets its point from the address pin instead. It is removable from these two only when a location stops needing a hand-placed point, which is tracked separately. **Known gap:** re-opening the picker on an existing structured address starts blank — the list returns `address_id` but no address detail behind it, and rebuilding a barangay code from stored text is the fuzzy match this design refuses.
- **TomTom Recalculation**: One-click recalculation triggers live TomTom routing queries to refresh distance and travel time estimates.

---

## Related

[[Dispatch]] · [[Trips]] · [[Reservations]] · [[Database Overview]] · [[Feature Index]] · [[ADR-015 Address Owns Administration, Location Owns The Point]]


## PR 4.5 ? Context-aware dispatch (2026-09-13, implemented)

PR 4.5 uses strict routed deadhead/reposition evidence: canonical catalog coordinates, original cache computation time, 90-second immediate cache limit, four workers and a bounded provider budget. No haversine-speed fallback becomes verified pickup ETA. Passenger duration feeds the same service window used by assignment and dispatch creation. Both resources? next bookings are checked independently; unknown origins, duration or provider results remain review-required.

Verification and remaining device acceptance: [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan#Implementation record ? 2026-09-13]]. Full suite: 1,140 passing tests; later focused checks: 37 passing tests; web build, Android export, route-auth audit and migration/query verification passed.
