---
type: feature
status: working
tags: [feature, routes, locations, tomtom, dispatch]
source:
  - src/app/(dashboard)/routes
  - src/app/api/routes
  - src/app/api/locations
  - src/lib/locations/coordinate-provenance.js
  - src/app/api/tomtom/route
  - src/services/route-resolver.service.js
  - src/services/route.service.js
  - src/services/route-feasibility-context.service.js
  - src/lib/tomtom.js
  - src/lib/routing/route-cache.js
  - src/lib/scheduling/route-feasibility.js
  - supabase/migrations/076_routes_integrity.sql
  - supabase/migrations/146_location_intake_identity.sql
last_verified: 2026-10-06
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


## Fully-dynamic hotel + airport locations — 2026-10-01 (implemented)

Hotel and airport endpoints are now DB-driven; no brand or terminal is a code
constant anymore:

- **Hotel** — authority is `system_settings.hotel_location` (edited at
  `/settings/general`, `PUT /api/settings/hotel`). The estimator's old
  `/coco star|coco/` regex and `CoCo Star Hotel` label are gone:
  `buildHotelEntry(hotel)` matches the configured hotel name plus generic
  on-site words (`hotel|lobby|property|base|…`), and `resolveHotelBase(hotel)`
  replaces the `HOTEL_BASE` constant (kept as a deprecated seed fallback).
- **Airports** — authority is the `locations` registry (managed via
  `/routes/locations`). `src/lib/naia-locations.js` is seed defaults only;
  `POST /api/routes/seed-naia` accepts an optional `{ terminals: [{ name,
  latitude, longitude }] }` payload (validated, unique names, max 50) and falls
  back to the seeds when omitted. `buildAirportEntries()` uses supplied rows,
  seeds otherwise.
- **Resolution order** (new `src/lib/geo/dynamic-locations.js`,
  `resolveCoordinatesWithDb(db, text)`, 30s cache): exact registry-name match
  (`canonical`) → configured hotel name / on-site words (`hotel`) → static
  gazetteer (`gazetteer`) → null (honest unknown, never guessed).
  `estimateTripWithDb()` prefers live-registry haversine, else the legacy
  estimator with the live hotel. Legacy/v1 readers retain this compatibility
  chain. Persisted v2 mobile, geofence, route-feasibility next-dispatch, and
  live-monitor reposition readers instead require the request's active linked
  Fleet coordinates; `resolveRequestEstimate()` has its own strict linked-ID
  path. Pure offline callers keep the seed-default `resolveCoordinates(text)`
  signature with optional overrides.
- **Injector** (`/reservations/new`) defaults are derived from the live
  registry (first airport-like location + configured hotel name), not string
  literals; settings copy is brand-neutral ("Sync Airport Routes").

Metro landmark overrides (Pasay/MOA, Makati/BGC, …) stay static by design —
scope was "Hotel + NAIA only".

Verified: new `src/lib/geo/dynamic-locations.test.js` (13 tests), updated
`trip-geofence.test.js` (seed fallback label is now `Hotel Base`), affected
suites 77 passed, ESLint clean on all touched files, production build clean.
Full suite 3502 passed / 6 failed — the six are the pre-existing failures
recorded for 2026-10-01 (auth-session, no-legacy-role, upload-storage,
standby ×2, driver-assignments), untouched by this change.

## PR 4.5 ? Context-aware dispatch (2026-09-13, implemented)

PR 4.5 uses strict routed deadhead/reposition evidence: canonical catalog coordinates, original cache computation time, 90-second immediate cache limit, four workers and a bounded provider budget. No haversine-speed fallback becomes verified pickup ETA. Passenger duration feeds the same service window used by assignment and dispatch creation. Both resources? next bookings are checked independently; unknown origins, duration or provider results remain review-required.

Verification and remaining device acceptance: [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan#Implementation record ? 2026-09-13]]. Full suite: 1,140 passing tests; later focused checks: 37 passing tests; web build, Android export, route-auth audit and migration/query verification passed.

## Fleet location codes — Task 1 (2026-10-06, prepared; migration not applied)

Migration `146_location_intake_identity.sql` adds a database-generated UUID `location_code` to each canonical `locations` row. A full unique index reserves codes across active and retired rows; the code is not derived from mutable names or addresses. The prepared location list/detail GET projections expose it for partner configuration. POST and PUT do not write a supplied code: new and versioned rows receive the database default, while in-place edits preserve the existing identity.

The Fleet location registry shows the code in a copyable list column and in the edit/detail dialog as read-only. Location list/detail GETs label `coordinate_provenance: canonical_registry` with the note `not independently verified` only for active rows with a complete finite in-range latitude/longitude pair; inactive, missing, partial, non-finite, or out-of-range coordinates receive no provenance label. The UI displays that label beside eligible coordinate pairs. No `verified` flag is added or set. This slice does not change route resolution, geofencing, navigation, or v2 intake behavior. The migration is prepared but unapplied, so the changed application code requires that migration before deployment. Static migration/API/UI tests and offline `db:check` are the evidence, not live catalog behavior.

## V2 request links remain fail-closed — Task 2 (2026-10-06)

The shared v2 intake writer now resolves supplied location codes strictly to existing active Fleet registry rows and stores only those IDs as request FKs. It never name-links v2 endpoints. Partner-proposed text/coordinates stay in the request's dedicated review JSONB fields, are not passed to route resolution, and are not projected through the generic integration log or create/pull responses. At the Task 2 boundary (before Task 3), v2 estimates remained null and no reusable route was created. Authorized reservation queue/register projections label a complete active linked Fleet coordinate pair `canonical_registry`, a proposal without a usable link `pending_review`, and all other endpoints `unknown`. PMS v1 retains its previous route-estimation and name-link behavior. Task 2 did not apply SQL; `npm run db:status` could not verify the live ledger because `.env.local` and `.env` are unavailable, so no live routing behavior is claimed.

## Strict v2 request estimates — Task 3 (2026-10-06)

`resolveRequestEstimate()` enters strict registry mode when explicitly requested or when a persisted request has a non-null `external_create_fingerprint`. V2 ingest explicitly passes `strictRegistry: true` before insert and supplies only the IDs resolved from Fleet location codes; proposal JSON is used only to label unresolved endpoints `pending_review`.

Strict v2 resolution returns unknown before endpoint resolution if either linked ID is missing. With both IDs, it sends null labels and disables name fallback. It requires each linked location to remain active and non-retired with a complete finite in-range coordinate pair before looking up even a stored route estimate. Eligible requests may use an active canonical route estimate or TomTom; missing/unusable registry points never invoke dynamic hotel/gazetteer or legacy text estimates and never read or persist a route. Unknown results use null distance/duration/source, basis `Canonical location unavailable`, stable reasons, and per-endpoint provenance (`canonical_registry` only for a usable linked row, otherwise `pending_review` when a proposal exists or `unknown`). PMS v1 resolution and estimator fallback remain unchanged.

Verification: focused resolver and ingest tests passed (53/53), touched-file ESLint passed, and `git diff --check` passed. No API route, migration, live SQL, generated schema, mobile, or geofence behavior changed; evidence is static/mock-based, not live database or deployment verification.

### Live-trip-monitor identity propagation — review round 1/5 (2026-10-06)

The monitor's full-mode request projection now includes the persisted v2 fingerprint, canonical pickup/drop-off IDs, and partner proposal fields, and forwards them with the labels to estimate resolution. This preserves strict v2 behavior through the live-trip reader: a missing linked ID remains unknown rather than being filled by name/gazetteer, while v1 requests with a null fingerprint retain legacy behavior. Verification: regression RED (1 expected failure because the projection lacked the fingerprint), then live-trip-monitor + route-resolver GREEN (51/51), touched ESLint, and `git diff --check`. Migration 146 remains unapplied and is an explicit pre-merge release hold; no live DB behavior is claimed.

### Task 4 Slice B — strict next-dispatch reposition (2026-10-06)

`findNextAssignedDispatch()` now selects the request's persisted fingerprint, explicit pickup/drop-off IDs, proposal-presence flags, and location rows joined only through those IDs. For a v2 request, a coordinate is usable only when that linked Fleet row is active, non-retired, ID-matched, and has a complete finite in-range pair. Missing, mismatched, retired, or invalid endpoints remain coordinate-unknown; proposal coordinates are never inputs, and a route endpoint cannot substitute for the request link. Endpoint provenance is returned independently as `canonical_registry`, `pending_review`, or `unknown`. Both route feasibility and live-trip reposition share this resolver; legacy v1 text/gazetteer fallback remains unchanged. The feasibility payload also carries strict request-estimate endpoint provenance; live monitor endpoint targets expose the same per-endpoint labels.

Verification: new RED on unchanged production (10 failures across route-feasibility-context and live-trip-monitor; v1 fallback stayed green), then focused GREEN (39/39), combined Task 4 mobile/geofence/feasibility/monitor suites (60/60), touched-file ESLint, and `git diff --check`. No route resolver, mobile route, geofence service, trip lifecycle, migration, or schema files changed. Verification is static/mock-based; migration 146 remains an unapplied release hold and live DB behavior is not claimed.

### Dispatch Radar recommendation endpoints — review round 1/5 (2026-10-06)

Dispatch recommendation feasibility now treats v2 request endpoint coordinates as a strict registry projection: only active, non-retired Fleet rows matching explicit request IDs with complete finite in-range coordinates are usable. The same rule applies to persisted preceding/next commitments, whose SELECT now includes the persisted fingerprint, pickup/drop-off IDs, proposal-presence flags, and ID-joined registry rows. Missing, retired, mismatched, or invalid v2 endpoints stay unknown instead of resolving partner text; proposals affect provenance only. V1 and tentative legacy text fallback remains unchanged.

Verification: dispatch-radar RED on unchanged production (9 failed, 17 passed after expanded regression cases), then 26/26 focused tests; combined dispatch-radar plus Task 4 mobile/geofence/route-feasibility/live-monitor suites passed 86/86, touched-file ESLint and `git diff --check` passed. Static/mock verification only; no live SQL, migration, or deployment behavior is claimed.

## Task 5 — Final v2 location-intake contract and release holds (2026-10-06)

- Each `locations.location_code` is a server-generated opaque UUID, immutable through the location APIs, and uniquely reserved across active and retired rows. V2 may link an endpoint only by a supplied code that resolves to an active Fleet location; sender-provided endpoint text remains unchanged and is never used to create or name-match a location. Unknown and retired codes reject.
- V2 partner endpoint proposals are durable, explicitly named request JSONB review records. They never create a `locations` row or directly supply route coordinates. They remain review-only until a future separate human dispatcher mapping action links the request to an active Fleet-managed location; routing can then use that canonical Fleet point, not the proposal. That mapping UI/action is not implemented.
- `canonical_registry` describes provenance from an active Fleet-managed point with a complete finite in-range coordinate pair; it does **not** mean independently verified. A proposal without a usable canonical link is `pending_review`; otherwise an unresolved endpoint is `unknown`.
- V2 estimates, mobile endpoint coordinates, geofence targets, route-feasibility/reposition legs, and dispatch-radar recommendations use only the request's explicit active location links. No v2 name matching, gazetteer, dynamic hotel, seed, stored-route-endpoint, or proposal-coordinate fallback is allowed. Missing, retired, mismatched, or unusable links yield null/unknown outcomes and no route is created or persisted. Legacy PMS v1 resolution remains unchanged.
- V2 remains create-only: revisions beyond the initial create and update/cancel semantics are not implemented. Candidate migration `146_location_intake_identity.sql` remains unapplied. Migrations 144/145 and candidate 146 must be reconciled with concurrent main Hotel/POS work before merge; any migration apply requires explicit approval. No live schema or RLS verification is claimed, and this contract does not imply PMS/POS connectivity.
