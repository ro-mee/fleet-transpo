---
type: feature
status: working
tags: [feature, tracking, gps, mobile]
source:
  - mobile/lib/tracking.js
  - mobile/lib/background-tracking.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-08-31
related: ["[[Trips]]", "[[Mobile Architecture]]"]
---

# Feature: Tracking

## What it does

Reports the driver's position to the server every 30 seconds during an active trip, in the **foreground** and, while an active trip is running, in the **background** (via `expo-task-manager`).

## How it works — CONFIRMED

Two decoupled mechanisms drive the foreground uploader (`mobile/lib/tracking.js`):

```js
// 1. Sensor → a ref. Fires whenever the device produces a fix.
watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })

// 2. Uploader → fixed cadence, independent of the sensor.
POST_INTERVAL_MS = 30 * 1000
POST `/api/mobile/driver/trips/${tripId}/gps`
```

**Decoupling the sensor from the upload is the design.** GPS fires at whatever rate the hardware and movement produce; the network sees exactly one request per 30 s regardless. Battery and data usage are bounded by a constant, not by how fast the van is moving.

`distanceInterval: 10` (metres) plus `accuracy: Balanced` further reduces sensor wake-ups — a stationary vehicle produces almost no updates.

## Location unavailable — hardened 2026-08-22

Both the map watcher and `useTripTracking()` now catch failures from permission/location initialization. If location services are disabled or the current fix is unavailable, the app stops the posting state, shows a recoverable message, logs a warning, and continues running instead of producing an unhandled promise rejection/red error screen.
The screen-side hook also derives the settings-disabled state and suppresses stale
errors when no trip is selected, so tab focus changes cannot leave a false posting
indicator or old trip error visible.

## Background — added 2026-08-19 (`mobile/lib/background-tracking.js`)

Foreground-only was a deliberate scope decision (see [[ADR-010 Foreground Only GPS]]); the app has since moved to a dev build, so background tracking is now implemented. See [[ADR-011 Background GPS Tracking]] for the full decision and trade-offs.

Summary: a headless task (`fleetops-background-location`) posts GPS and accumulates per-leg km while the app is backgrounded during an active trip. `mobile/app/(app)/(tabs)/map.js` starts it on background via `AppState`, stops it and merges the accumulated km on return. The foreground watcher stays the source of truth; the task only fills the backgrounded gap.

**Requires a custom dev build** (not Expo Go) and, for Android production release, Play Store review with a justification.

→ [[Mobile Architecture]] · [[ADR-011 Background GPS Tracking]]

## Trip-Scoped & Status-Aware Live GPS Architecture — 2026-08-31 (Commit `abdc001`)

To prevent idle or stationary vehicles from polluting historical trip breadcrumbs and to give operators accurate visibility into active fleet movement:

1. **Trip-Scoped Ping Ingestion (`src/lib/gps.js`)**:
   - `/api/mobile/driver/gps` and `/api/mobile/driver/trips/[id]/gps` now validate trip status.
   - Pings are strictly recorded to `gpstracking` only when a driver is actively executing an `In Progress` trip. Stationary pings from drivers parked at the depot or between trips are discarded.
2. **Stale Connection & Disconnect Detection**:
   - Implemented `isStaleGps()` using a 3-minute threshold (`GPS_STALE_THRESHOLD_MS = 3 * 60 * 1000`).
   - If a vehicle in `In Progress` or `Dispatched` has not emitted a ping for > 3 minutes, its status indicator flags it as "Stale/Disconnected" with last-ping age context.
3. **Web Live Map Overhaul (`/tracking/live-map` & `src/components/maps/live-locations-map.jsx`)**:
   - **Status Filtering**: Interactive filter chips (*All*, *In Progress*, *Dispatched*, *Assigned*, *Stale/Disconnected*).
   - **Color-Coded Status Markers**: Emerald for In Progress, Amber for Dispatched/Assigned, and Slate for Stale/Inactive.
   - **Isolated Breadcrumbs**: Breadcrumb routes render exclusively for the currently selected active trip, eliminating overlapping polyline noise across the map.
   - **Driver Telemetry Drawer**: Displays live speed, compass heading, estimated destination ETA, and connection health.
   - **Always auto-fit viewport (2026-09-03)**: `MapViewport` re-fits the view to all pins (or the selected trip's route/marker) on every GPS poll — removed the stable `focusKey` guard that skipped re-fitting when the marker set was unchanged. Drivers that move out of view are re-centered on the next 15s refresh; user pans are also re-fitted on refresh (accepted trade-off, same behavior as the incident map's `FitBounds`).
   - **Permanent vehicle labels (2026-09-03)**: vehicle markers on latest-locations data (`/tracking/live-map`, role dashboards) show a permanent tooltip label — status-color dot + plate + driver name — no hover/click needed; the click popup (telemetry, Street View) is unchanged. Raw GPS-history rows (`/trips/[id]`) have no identity, so they keep the plain hover tooltip. Also fixed plate resolution reading nested `l.vehicles.plate_number` (was flat access, so labels/popups fell back to "Vehicle #N").
   - **No-gray markers & navigation panel removed (2026-09-03)**: `STATUS_COLOR` now maps *every* `LIVE_TRIP_STATUSES` phase (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); previously unmapped statuses fell back to gray. `DEFAULT_MARKER` is blue, not gray. The floating "Live Route Navigation" panel (turn-by-turn instructions, distance/ETA chip) was removed from the component along with the `instructions`, `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props; the route polyline, origin/destination pin labels, and the sidebar trip metrics remain.
   - **Incident layer removed (2026-09-03)**: Open-incident markers, the "Open incidents" stat card, and the sidebar incident list were removed from the live map — the Incidents module (`/incidents`) already plots incidents on its own map, so the layer was redundant. `LiveLocationsMap` no longer accepts an `incidents` prop (incident pin rendering, legend entry, and CSS deleted from the component).
   - **Marker key collision fixed (2026-09-04)**: `CircleMarker` React keys now prefer the per-row `tracking_id` / `gps_tracking_id` over `trip_id`. GPS-history rows (`/trips/[id]` map) all share the same `trip_id`, so the old `trip_id ||` key chain gave every breadcrumb of a trip the identical key (React "two children with the same key" error, duplicated/omitted markers on each 15s refetch). The coordinate fallback also appends the row index so a stationary vehicle (identical consecutive coords) can't collide. Latest-locations rows keep working — one row per trip, `gps_tracking_id` unique.
   - **Ctrl + scroll to zoom (2026-09-04)**: the live map (and every `LiveLocationsMap` consumer — `/tracking/live-map`, role dashboards, `/trips/[id]`) now zooms on ctrl/⌘ + wheel and ignores plain wheel scrolling, flashing a "Use ctrl + scroll to zoom the map" hint for 1.2s on plain scroll — the same UX the incident map already had. The handler + hint overlay were extracted to the shared `src/components/maps/map-ctrl-zoom.jsx` (`MapCtrlZoom` / `ZoomHintOverlay`); `incident-map.jsx` now consumes the shared module instead of its private copy. Plain scrolling no longer gets swallowed by the map when zoom is disabled. The 15s auto-fit still re-fits the viewport on each GPS poll (existing accepted trade-off).
4. **Mobile Lifecycle Synchronization**:
   - Background tracking tasks mount and unmount strictly on active trip state transitions (`In Progress` starts the watcher; completing or cancelling a trip terminates the background task and releases wake locks).

## Database

Every accepted fix is appended to `gpstracking` with `vehicle_id`, `trip_id`, coordinates, motion metadata, accuracy, and `recorded_at`. The same request also updates the driver's latest latitude/longitude for the live map. Route history is therefore retained per trip; the driver row is only the latest-position cache.

## Web: Trip Timeline — HIDDEN FROM NAV 2026-08-23

`/tracking/history` (the "Trip Timeline" / completed-trips review table) is **out of scope** and was removed from the sidebar (`workspaces.js`, incl. the management "Operational Review" entry), the command palette, and the `/tracking` module card. Nothing was deleted — the page still works via direct URL (`permissions.js` unchanged), and executive dashboard stat links to it still resolve.

## GPS Ingest Enrichment — PR #3 Arrival Intelligence (2026-09-08)

Both ingest paths (`/api/mobile/driver/trips/[id]/gps` POST and `/api/trips/[id]/locations` POST) now return a `geofence` object alongside the stored row: `near_pickup`, `near_destination`, `distance_to_pickup_m/_destination_m`, `geofence_state` (known/unknown), and per-end verdicts. Targets resolve per trip (canonical location + radii → gazetteer → null) with a 5-min cache. Fixes worse than ±150 m accuracy are stored but yield UNKNOWN, never an arrival claim. The mobile foreground poster publishes the verdict to screens, which render "near pickup/destination" banners — the swipe/button transitions stay human-confirmed. No status is ever auto-mutated by position.

**Target derivation fix (2026-09-08):** `getTripGeofenceTargets`'s re-query selected `origin, destination FROM trips` — columns that do not exist (migration 007 dropped them). On the live database that query raised "column does not exist" and the function's catch silently returned `{pickup: null, destination: null}` for **every** trip: no geofence verdicts, no monitor target/corridor, and the live map's route line never drew for request-dispatched trips (no `route_id`). The re-query now derives endpoint names through the dispatch's booking request first (route as fallback) — the same chain as `src/lib/api/trips-query.js` — pinned by a regression test. Lesson (third strike of the same bug class): mocked `db.query` tests never touch the real schema, so every new SQL must be run against the live database before "done".

## Connectivity vs GPS — PR #3.1 (2026-09-08)

Connectivity status and GPS status are separate surfaces. Offline + live trip tracking renders "Offline · GPS still recording / Last synced {age} · Showing saved data · Dispatcher may see your last synced location" — only when the poster is genuinely feeding the current trip (trip id set, no poster error, post within 90 s), never inferred from merely being offline, and never "live location active". GPS lifecycle, posting cadence, and geofence rules unchanged. → [[Mobile Architecture]]

## Offline Read Mode fix (2026-09-08)

The login route returns camelCase (`employeeId`) and `signIn` stores it verbatim, but `resolveDriverId` matched only snake_case — the offline cache was never written nor read on any screen, and `clearOfflineCache` was dead code. Fixed (camelCase first); regression-pinned against the exact wire shape. Work Schedule became the 4-state template (offline+cached rows+inline note / offline+never-synced card / online+confirmed-empty / online+data), with per-source `syncedAt` as the confirmed-empty signal. Details → [[Mobile Architecture]] Offline Read Mode.

## Live Monitoring & Delay Intelligence — PR #4 (2026-09-08)

While a trip is live, the system now answers the four operational questions deterministically — *okay pa ba ang trip? male-late ba? nalilihis ba sa route? maaapektuhan ba ang susunod na assigned trip?* — and **recommends only**: nothing in this layer mutates a trip, dispatch, or assignment (the AI copilot is PR #5, separate).

- **Shared phase resolver** (`src/lib/trip-phase.js`): the ONE trip_status → phase (to_pickup / to_destination) interpretation, consumed by the live map AND the monitor. No private status list exists anywhere else.
- **Pure engines** (no DB/network): `src/lib/monitoring/live-trip-monitor.js` condenses risk to NORMAL / WATCH / ATTENTION / ACTION / UNKNOWN (delay thresholds 5/10/15 min; next-ASSIGNED-trip slack with a 10-min turnaround floor; UNKNOWN never downgrades to NORMAL — "can't tell" is not "all good"); `src/lib/geo/off-route.js` confirms a deviation only on **>250 m × 2 consecutive valid observations** (accuracy ≤150 m, ≤5 min fresh) and clears it on <150 m × 2 (hysteresis).
- **I/O service** `src/services/live-trip-monitor.service.js`, two locked modes: **fleet summary = cheap triage** (`summarizeFleet` — cached signals + durable alert rows only, never a fresh TomTom call per trip) and **selected trip = expensive precision** (`evaluateLiveTripMonitor` — fresh traffic-aware ETA, passenger minutes, next-trip reposition routing). The off-route **corridor is intent-anchored** — a pinned polyline refreshed only on phase/target change or 10-min expiry, never mid-deviation (re-anchoring per ping would launder a detour into "on route"); the ETA leg is vehicle-anchored and refreshes on movement. Off-route streaks read from the `gpstracking` breadcrumbs (latest 3), never process memory — serverless-safe.
- **Durable alerts** (`trip_monitor_alerts`, migration 109): writes only on appear / severity-jump / resolve; notifications fire on **threshold entry** (into ≥ATTENTION → Warning to the dispatcher; into ≥ACTION → Alert to dispatcher + fleet_manager with push), so NORMAL→ACTION, WATCH→ACTION, UNKNOWN→ACTION and ATTENTION→ACTION each notify exactly once. **Resolution is lifecycle-owned**: `completeTrip`/`cancelTrip` resolve a trip's active alerts inside their transaction; the fleet endpoint keeps only a defensive sweep.
- **APIs**: `GET /api/trips/live-monitor` (fleet triage, `trips:read_all`) and `GET /api/trips/[id]/live-monitor` (full evaluation; a driver may read their OWN trip — foreign trips 404). `/api/trips/latest-locations` stays raw telemetry, untouched.
- **Web Live Operations UI** (`/tracking/live-map`): LIVE OPERATIONS strip + risk chips (All / Action / Attention / Watch / Normal / GPS issues — chips filter the trip LIST only, never the map). The selected-mission drawer gains the monitor block: risk badge, live ETA, schedule delay, traffic delay, route status, **next assigned trip** impact sentence, signals list, and View Trip / Review Reassignment / View Incident links. Map markers get a restrained risk accent (ACTION rose+pulse, ATTENTION/WATCH amber, UNKNOWN gray; NORMAL and stale-GPS markers unchanged). Each **Active trips list row** also shows the derived trip endpoints — `pickup → drop-off` from the request, falling back to the route (`routeLineFor`, same derivation chain as the drawer; silent for manual trips with neither — trips has no origin/destination columns, see `src/lib/api/trips-query.js`). An evaluation of restoring `trips.origin/destination` as stored columns (2026-09-08) rejected it: 40% of dev trips have no request/route to source them, and a stored copy would dual-source the request's truth. The map's route line resolves its target from the trip's route record; trips dispatched straight from a request have none, so `mapTargetFor` falls back to the monitor's geofence-resolved target (detail evaluation first, then the cheap fleet row — same shared phase resolver, so the kinds always agree).
- **Mobile**: both GPS POST routes return a `monitor` payload (ingest-side `evaluatePingMonitor`, best-effort — a banner failure can never fail the GPS write). The foreground poster publishes it trip-id-tagged (same staleness guard as the geofence verdict), and the map screen shows ONE calm banner while en route — "Route deviation detected / Check your navigation when safe." · "Heavy traffic ahead / Arrival may be delayed by about N min." · "GPS updates delayed / Keep location access enabled." Derivation is a pure RN-free module (`mobile/lib/monitor-banner.js`, re-exported by `tracking.js`). No risk-level jargon and no dispatcher-style next-trip panic copy while driving.
- **Route line persists on stale GPS (2026-09-08):** the live map's trip route line no longer vanishes when the driver's GPS is delayed/offline. The origin is now the LAST KNOWN position (any valid fix), and staleness is communicated rather than hidden: a dashed/dimmer polyline (`routeStale` prop on `LiveLocationsMap`), a "· last known position" suffix on the origin pin label, and "Route drawn from last known position" / "· from last known position" in the selected-mission drawer. The **rescue route keeps its strict freshness rule** — its ETA ladder is a live-response tool, not corridor context, so a stale responder fix still shows "Waiting for a fresh responder GPS fix" instead of drawing.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]] · [[ADR-011 Background GPS Tracking]]
