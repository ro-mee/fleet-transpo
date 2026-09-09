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

## Map Weather Chip — 2026-09-09

Ambient current-conditions pill on the driver map screen, fed through the GPS ingest response. **Weather is permanently chip-only** — never a banner, toast, or notification; actionable issues (off-route / traffic / GPS) keep the one banner surface, weather is quiet context beside them (see [[Mobile Map Weather Chip Implementation Plan]]).

- **Server**: `src/lib/weather.js` — Open-Meteo current-weather adapter (keyless). `parseCurrentWeather` is pure (WMO code → label; unknown code → null); `getCurrentWeather` caches per coarse ~0.1° grid cell for 10 min (failures cached 1 min so an outage isn't hammered per ping) and caps the provider call at ~2 s — the poster waits on this response every 30 s, so weather must fail fast and open to null. The **post-write advisory block is now shared**: `src/services/ping-advisories.service.js` (`buildPingAdvisories`) builds geofence + monitor + weather for BOTH POST handlers (`/api/mobile/driver/trips/[id]/gps` and `/api/trips/[id]/locations`), ending their duplication. Auth stays route-specific (driver-only vs permission-checked) — only the enrichment was extracted.
- **Mobile**: `weather`/`weatherTripId` in `usePosterStatus` (published from the GPS POST response, trip-id-tagged; cleared immediately when the active trip changes — Trip A's weather can never show on Trip B). Pure derivation `mobile/lib/weather-chip.js` (`weatherChipFor` → `{icon, temperature, label}`, WMO→Ionicon table; invalid/unknown → null, and `formatTemperature` guards null-vs-0 so a missing temperature is silence, never "0°"). `mobile/components/WeatherChip.js` renders the compact pill (content-fit, token-styled, no press/animation/skeleton) **in the Home header, beside the notification bell** (moved 2026-09-09 from the map's floating-controls row per review — the map screen shows no weather surface). **Label precedence: place over condition** — the chip shows WHERE the driver is ("Quezon City"); the icon carries the condition, so strings like "Heavy Drizzle" never appear. `weatherChipFor` prefers the server's `placeName`, falls back to the condition string only when no truthful place resolved, and renders nothing when neither exists. No new location stream — the chip uses the coordinates of the ping the driver already posts, so idle drivers (no pings) get no weather, same trip-scoping as GPS itself. No DB write, no migration. A claymorphism restyle of the header (app-background pill shell, condition-tinted icon discs, clay shadows on avatar/bell) was applied and then **reverted the same day after on-device review** — the original surface/border idiom looked better; no styling decisions from that pass survive.
- **Place label (reverse geocoding, 2026-09-09):** `src/lib/geo/reverse-geocode.js` — TomTom reverse-geocode adapter reusing the existing SERVER key (`getServerKey()`; null when unconfigured — no place, never an error). `parsePlaceName` prefers municipality → locality → countrySecondarySubdivision → countrySubdivisionName; cached per coarse ~0.1° grid cell for 24 h; ~2 s timeout; fail-open. `src/lib/weather.js` gains `getCurrentConditions` = weather + `placeName` composed in one payload (place failure never loses the weather) — used by both the GPS ingest advisories and `/api/mobile/driver/weather`.
- **No-trip weather (2026-09-09, same day revision):** the chip must be visible whenever there is a truthful payload, not only en route. New `GET /api/mobile/driver/weather` (driver-authenticated) resolves position from `latitude`/`longitude` query params (the app's one-shot fix, only read when foreground permission is already granted — the endpoint never triggers a prompt) → falling back to the driver's last-known position (`drivers.current_*`) → `weather: null`. `mobile/lib/ambient-weather.js` (`useAmbientWeather`) fetches it on a 10-min cadence (aligned with the server cache TTL — one Open-Meteo call per cell per TTL across BOTH the GPS ingest path and this endpoint, they share the cache) and feeds the Home chip when the poster has no trip payload. Trip weather still wins while a trip is live (freshest, same rail as geofence/monitor); the ambient fetch covers idle/between-trips; no truthful payload → no chip. One-shot fetch, never a position watcher — a decorative chip does not justify continuous location.
- **Route line persists on stale GPS (2026-09-08):** the live map's trip route line no longer vanishes when the driver's GPS is delayed/offline. The origin is now the LAST KNOWN position (any valid fix), and staleness is communicated rather than hidden: a dashed/dimmer polyline (`routeStale` prop on `LiveLocationsMap`), a "· last known position" suffix on the origin pin label, and "Route drawn from last known position" / "· from last known position" in the selected-mission drawer. The **rescue route keeps its strict freshness rule** — its ETA ladder is a live-response tool, not corridor context, so a stale responder fix still shows "Waiting for a fresh responder GPS fix" instead of drawing.

## Live map Drop-off infinite-loading fix — 2026-09-09

Driver report: with the active trip at `Drop-off`, opening the live map (`mobile/app/(app)/(tabs)/map.js`) spun on `globe.json` forever. Three parallel diagnoses agreed the `Drop-off` status strings themselves were consistent everywhere (`Drop-off` canonical in `src/lib/constants.js`, DB CHECK, `GPS_TRACKING_STATUSES`, `isState4`) — the sheet state machine was fine. The stuck loader was the `!mapReady` overlay whose only writer is the WebView's `MAP_READY` post:

- **Root cause (most likely):** `pickupLabel`/`dropoffLabel` were interpolated raw into single-quoted JS inside the WebView HTML (`TomTomMap.js`). The Drop-off leg is the first time the *destination* name is injected (`Drop-off: ${destination}`), so a destination with an apostrophe (e.g. `Queen's…`) broke the whole `<script>` block — `initMap()` never ran, `MAP_READY` never fired, overlay never lifted. Fixed with `escapeJsSingle` (backslash → single-quote → newline) for both labels.
- **Hardening:** `MAP_READY` is now posted *before* `applyFleetMapTheme()` (which runs in try/catch), so a theme failure can't strand the overlay. `map.js` fail-opens both remaining infinite paths: overlay auto-lifts 20 s after mount if `MAP_READY` never arrives, and the fullscreen GPS loader falls through after 15 s to render from the trip's stored coords (idle map falls back to Manila 14.6, 121.0). Also fixed the idle-branch overlay condition (`(!activeTrip || !mapReady)` was always true inside the `!activeTrip` branch → now `!mapReady`).
- Null `destination_latitude/longitude` (request-dispatched trips with no `route_id` + gazetteer miss) was ruled out as the loader cause — it only suppresses the dest pin/route/ETA, and `MAP_READY` fires before those guards.

## Arrival gates — 2026-09-09 (spam-proof proximity enforcement)

Driver report: the live map let a trip advance from pickup to Drop-off by
spamming the swipe — the "far away" warning could be retried through.
Investigation (3 parallel agents) found the real shape of the hole:

- `at-pickup`, `onboard`, `dropoff` had **zero** proximity enforcement, client
  or server — only `complete` was gated (PR #3). There was nothing to bypass;
  the warning the driver saw was the completion pre-check only.
- `SwipeButton` had no in-flight lock (`busy` prop existed but was never
  passed/checked on the gesture path), so a second swipe could double-fire a
  transition while the first PUT was still pending.
- The check verdict itself is non-deterministic across retries (new ping
  lands, 10-min freshness decay flips outside→unknown), so retry-until-green
  could land on a favorable read.

Fix — gates at the choke point, override-with-reason (same pattern as the
completion gate, never a hard block that could strand a driver):

- `setTripStatus` (`src/services/transition.service.js`) now enforces:
  `At Pickup` / `Passenger Onboard` must sit inside the **pickup** geofence,
  `Drop-off` inside the **destination** geofence, evaluated from the server's
  own latest GPS ping. `outside` → 409 (`GEOFENCE_OUTSIDE`) unless the call
  carries `{ geofence_override: true, geofence_reason }` (reason required,
  400 without it, written to audit). `unknown` stays fail-open. `En Route` is
  deliberately ungated (mid-leg consequence of onboard — gating it on the
  pickup would 409 legitimate retries filed after leaving the pickup area).
- New `checkPickupProximity` (`trip-geofence.service.js`, shared core with the
  destination check) + `GET /api/trips/[id]/pickup-check` advisory endpoint.
- Mobile: `map.js` pre-checks pickup/destination before the PUTs — outside
  offers Go Back / Proceed Anyway, and Proceed Anyway goes to the new generic
  `trip/override` screen (typed reason → PUTs with override). A 409 race
  between check and PUT surfaces the same offer. Swipe carries `busy`
  (in-flight lock in `SwipeButton` gesture path + dimmed track).
- Verified: eslint clean, `trip-geofence` + `geofence` + `trip-state` 31/31
  green (3 new pickup tests), route-auth audit 259/259.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]] · [[ADR-011 Background GPS Tracking]]
