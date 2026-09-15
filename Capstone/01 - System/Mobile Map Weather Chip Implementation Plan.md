# Mobile Map Weather Chip Implementation Plan

**Instant-paint revision (2026-09-13):** Cold open showed a blank slot for seconds because the hook awaited a GPS fix before any network, the server resolved weather+place serially, and nothing was cached. Now: (1) last-good payload cached in AsyncStorage (`AMBIENT_WEATHER`, per-driver namespace, cleared on logout) paints instantly on mount, revalidated after interactions settle; (2) GPS decoupled — coord-less fetch fires immediately (server last-known fallback), one-shot fix refines only on coarse-cell change; null payloads never wipe last-good and never setState. (3) Icon accuracy: Open-Meteo `is_day` passes through to a night mapping (clear→moon, partly→cloudy-night, rest unchanged; missing flag falls back to day), drizzle family normalized to `water`, all rain codes to `rainy` (drops the stray `rainy-outline`), glyph allowlist asserted in tests; fixed the `28°`+`C` double-suffix and memoized the chip (30s Home tick no longer recomputes clay shadows), Map adopts the same field-wise chip memo. Verified: full suite 102 files / 1117 tests pass, ESLint clean on all touched files, Android Hermes export bundles (5.11 MB); device visual review pending.

**Map instant-theme revision (2026-09-13):** Toggling light/dark (e.g. in Profile) only visibly applied on the Map tab after switching to it, with a full map reload (SDK re-download, re-init, dropped route). Root cause: `TomTomMap.js` `htmlContent` memo depended on `colors, scheme`, so every theme switch rebuilt `source` — while the cheap `applyFleetMapTheme` inject path existed but lost the race. Now `colors/scheme` are out of the memo deps (initial HTML still bakes the active palette for correct first paint); theme flows through a ready-guarded inject that repaints canvas layers, flips the body class + root color-scheme, re-tints route lines from cached inputs (badges cleared first, no duplicates) and repaints origin/dest pins. Page chrome (popups, nav banner, radar markers/labels, cluster badges) follows via dual-scheme CSS overrides backed by a baked `FLEET_TOKENS` + live `tc()` helper; dynamic route/marker colors also read `tc()` at render time. A toggle landing mid-reload is parked and flushed on MAP_READY. Structural props (radarMode, origin/dest, labels) still reload — correctly. Verified: full suite 104 files / 1127 tests pass, ESLint clean, Android Hermes export bundles (5.16 MB); device check pending (toggle in Profile → Map instant, no spinner, route intact).

**Standby revision (2026-09-13):** The Driver Live Map now also shows compact weather at bottom-left above navigation, per the new standby brief. It reuses useAmbientWeather, which exposes the original provider payload alongside the unchanged chip derivation. Temperature, condition, place and local day/date render in the existing ClayCard; no payload means no card. Home weather is unchanged. This supersedes the Home-only placement below. Verified with ESLint, weather/coverage/clay tests (14 passed), and successful Android Hermes export; device visual review pending.

Date: 2026-09-09
Status: Implemented 2026-09-09. Automated checks (967 vitest tests incl. new weather/advisory suites, ESLint on all touched files) passed. Native device acceptance pending. No commit.

**Placement revision (2026-09-09, after review):** the chip was originally placed in the map screen's floating-controls row; it now renders **only in the Home header, beside the notification bell** (`mobile/app/(app)/(tabs)/index.js`). The map screen has no weather surface — all map-context derivation was removed with it. All other behavior is unchanged.

**Always-visible revision (2026-09-09, second review):** the chip must render whenever there is a truthful payload, including with no active trip. The GPS-POST rail is trip-scoped by design, so a second rail covers the idle case: `GET /api/mobile/driver/weather` (driver-authenticated) resolves the driver's position from optional one-shot query coordinates (read only when foreground permission is already granted — never a prompt) falling back to `drivers.current_*` last-known position, then reuses the same cached `getCurrentWeather`. `mobile/lib/ambient-weather.js` fetches on a 10-min cadence; the poster's trip payload takes precedence while a trip is live. This supersedes the plan's original trip-scoped-only stance (idle drivers now DO get weather at their last-known position) — the "no new location stream" constraint is kept: one-shot reads, never a watcher.

**Place-label revision (2026-09-09, third review):** the chip's label is now WHERE, not WHAT — a reverse-geocoded place name ("Quezon City") instead of a condition string ("Heavy Drizzle"), with the icon carrying the condition. This supersedes the plan's original "no location name / out of scope" stance: a truthful source now exists (TomTom reverse geocoding, reusing the existing server key — `src/lib/geo/reverse-geocode.js`, pure `parsePlaceName` with municipality→locality→subdivision preference, 24-h coarse-cell cache, fail-open null). `getCurrentConditions` composes weather + `placeName`; the mobile derivation prefers `placeName`, falls back to the condition string, and renders nothing without either. Icons stay Ionicons on the standard chip shell — a custom `react-native-svg` icon set was considered and rejected (native rebuild for one decorative pill).

**Clay header pass — applied then REVERTED (2026-09-09, same day):** a Driver Home Header claymorphism spec pass (app-background pill shell, condition-tinted icon discs, clay double-shadows on avatar/bell, 6dp pill-to-bell gap, green bell glyph) was implemented and reverted after on-device review made the header look worse. The surviving header styling is the pre-pass idiom: pill on `colors.surface` with a faint border, primary-colored Ionicons glyph, 10dp gap, untouched avatar/bell cards. Recorded so the same experiment is not re-attempted blindly.

## Direction and scope

Add a compact ambient weather chip to the driver's map screen, reflecting real-time weather at the driver's current GPS position during an active trip. This is **informational context only**, delivered through the existing GPS ingest rail — no new location stream, no device-side API keys, no notification.

**The chip is the only form weather ever takes in the mobile UI.** Weather must NOT be rendered as:

- a full-width banner
- a warning card
- a toast
- a push notification (no `expo-notifications` route, no `src/lib/notifications/copy.js` entry)
- a modal

**There is NO severe-weather banner state — permanently.** Even during heavy rain or thunderstorms, the same compact chip remains. Only the icon, weather label, and (if necessary) a subtle tone/accent change. This division is deliberate and mirrors the existing responsibility split:

- Off-route / traffic / GPS issues → existing monitor banner (`mobile/lib/monitor-banner.js`, map screen en-route banner) — actionable driving issues
- Weather → compact chip only — ambient context

The weather chip must not compete with: trip actions, navigation, off-route warnings, traffic warnings, GPS warnings, or the arrival/pickup hints.

## Visual language

Match the reference proportions and interaction density, not its exact visual styling. The component must look native to the existing FleetOps mobile design system rather than copied from another app. Reuse existing tokens and conventions:

- `colors` / theme tokens (no hardcoded palette), `fonts` typography
- the map screen's existing border-radius language and pill shapes (see the traffic `+N min` chip and recenter/overview control buttons for the established compact-surface idiom)
- Ionicons for the weather icon
- existing shadow/elevation conventions (subtle, non-intrusive)

Layout (compact horizontal):

```
[ icon ]  28°          <- temperature as primary value
          Light Rain   <- short condition as secondary text
```

Implementation constraints, made specific:

- Height: roughly 40–46 px; width: content-fit, never full width
- Horizontal padding: compact; weather icon 18–22 px
- Temperature: semibold, visually dominant; condition: smaller secondary text, max 1 line
- No chevron, no press state, no notification badge, no animation, no shimmer, no skeleton
- Non-interactive (informational context only) with an `accessibilityLabel` combining value and condition ("28 degrees, Light Rain")
- Premium and polished, visually lightweight, designed to sit naturally in the map/header controls without covering important map content

The anchor is deliberately not hardcoded in this plan: implementation must inspect the actual map geometry first. Constraints: the chip must not overlap the monitor banner, the arrival hints, the trip action controls, the bottom sheet, or important map controls (recenter/overview). Respect safe-area and the existing dark-mode / high-contrast token overrides — no custom palette.

## Data truthfulness

The temperature and condition text come from the weather provider — never invented. Do not fabricate:

- a location label ("Quezon City") — that would require reverse geocoding, which is out of scope; the Home plan already established "do not infer weather or sub-city labels". The pill shows **temperature + condition** (e.g. `28° / Light Rain`), not a place name. A location label may be added later only if a truthful existing source is identified.
- a forecast, feels-like, wind, or any field the provider response does not supply
- a placeholder, error state, retry UI, or skeleton when there is no truthful weather payload — **render nothing**; absence is the graceful state

## Server side — weather service (new `src/lib/weather.js`)

Pure fetch+parse module, modeled on `src/lib/tomtom.js` conventions:

- Provider: **Open-Meteo** current-weather endpoint (`https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code`). Free, no API key — no new secrets.
- Parse the WMO `weather_code` into `{ temperatureC, code, label }` where `label` is a short human string. Parsing must be a pure, RN-free, exported function (`parseCurrentWeather`) for vitest.
- Cache: in-memory `Map` keyed by a **coarse ~0.1° grid** cell (documented as approximate — longitude distance varies with latitude, so no exact-km claim), TTL **10 minutes**. Weather changes slowly; GPS pings arrive every 30 s — the provider must never see a per-ping call. Best-effort per server instance — the same stance as the geofence target cache and the live-monitor in-memory map (durable state stays in Postgres; weather is explicitly not durable system state).
- Timeout: **~2000 ms** (`AbortSignal.timeout(2000)`), fail open to `null`. Weather is non-critical ambient information attached to a GPS ingest response; it must not materially delay the GPS response the poster waits on. Every failure path returns `null` — never throws.

## Server side — GPS ingest enrichment (both existing POST handlers)

The repo currently does **NOT** have one shared GPS-ingest implementation. There are two separate POST handlers that each duplicate GPS persistence + geofence + monitor enrichment:

- `src/app/api/mobile/driver/trips/[id]/gps/route.js`
- `src/app/api/trips/[id]/locations/route.js`

Weather behavior must remain consistent across both. Before duplicating weather enrichment in both routes, inspect whether the common post-validation/post-write enrichment can be safely extracted into a small shared server helper — that is better architecture than adding the weather code twice. **Do not merge or alter their auth behavior**: the mobile route remains driver-only (`requireDriver()`), the general locations route retains its existing permission checks (`requirePermission("trips", "update")`). Only the post-write enrichment is a candidate for sharing, and only if extraction is safe.

Both handlers' responses gain a `weather` object:

- Derived from the just-ingested fix's coordinates — the position the driver is already sending. **No new location source.**
- Best-effort and isolated: a weather failure can never fail the GPS write (same guarantee as `evaluatePingMonitor`). Compute after the write, wrapped in its own try/catch.
- `weather: null` when the cache/fetch fails or the driver has no active trip — the mobile chip simply doesn't render.

This follows the trip-scoped GPS stance: idle drivers don't post GPS, so idle drivers don't get weather. The chip is an en-route surface, same as the monitor banner.

## Mobile — pure derivation (`mobile/lib/weather-chip.js`)

RN-free pure module (same pattern as `monitor-banner.js`, re-exported by `tracking.js` for the screens), so the root vitest suite can exercise it:

- `weatherChipFor(weather)` → `{ icon, temperature, label } | null`; null for null/invalid payloads.
- WMO code → Ionicon name mapping (`sunny`, `partly-sunny-outline`, `cloudy`, `rainy`, `thunderstorm`, `snow`, `water` for drizzle, etc.) — pure table, tested.
- Temperature formatting: whole degrees, `°` suffix, Celsius.

## Mobile — poster publication (`mobile/lib/tracking.js` / `usePosterStatus`)

The foreground poster's GPS POST response already publishes `geofence` and `monitor` (trip-id-tagged). Add weather the same way — it is architecturally consistent with the existing `posterStatus` shape:

```
weather: null,
weatherTripId: null,
```

published after each trip GPS POST:

```
publishStatus({
  ...
  weather: res?.weather ?? null,
  weatherTripId: tripId,
});
```

with the same trip matching guard on the map screen as geofence/monitor.

**Additional safeguard:** when `activeTripId` changes to null or to a different trip, clear weather immediately rather than waiting for the next successful GPS response. Conceptually, a trip-id transition clears `weather`/`weatherTripId` (and, if inspection confirms it is safe and consistent with existing semantics, the geofence/monitor fields too):

```
publishStatus({
  activeTripId: tripId,
  ...(oldTripId !== tripId
    ? { weather: null, weatherTripId: null }
    : {}),
});
```

Implementation must inspect the existing clearing behavior first — do not alter working geofence/monitor semantics unnecessarily. The invariant to verify explicitly:

**Weather from Trip A must never remain visible while Trip B is active or while no trip is active.**

Only the foreground poster publishes weather (map screen). The background task does not need it — the chip is a foreground UI surface.

## Mobile — component (`WeatherChip`)

One focused component (~40–50 lines), styled per the Visual language section. Let implementation inspect whether `mobile/components/WeatherChip.js` or `mobile/components/weather/WeatherChip.js` better matches existing conventions — do not create a whole feature directory hierarchy for one small pill unless the repo convention supports it.

- Renders `null` when the derived payload is null (offline, fetch failure, no trip) — no placeholder, error text, or skeleton.
- Placed in the map screen (`mobile/app/(app)/(tabs)/map.js`) at an anchor chosen after inspecting actual map geometry, per the placement constraints above.
- Dark mode / high contrast: tokens only.

## Validation

- Vitest: `parseCurrentWeather` (valid, missing fields, null), the WMO→icon table (every mapped code resolves to an Ionicon name string), `weatherChipFor` (null/invalid/valid), poster staleness guard for the weather payload (Trip A weather never visible on Trip B / no trip).
- Server: weather enrichment never fails the GPS write (test with a failing `fetchImpl`, GPS row still succeeds).
- `npm run db:check` unaffected — no migration; no schema change; no DB write for weather.
- Mobile: chip renders in light/dark, absent when `weather: null`, and coexists visually with the monitor banner (both visible simultaneously — weather stays small, banner keeps its full-width warning role).
- ESLint on touched files; existing mobile + server test suites pass.
- Manual: with an active trip and GPS posting, chip appears and updates as the driver moves between grid cells; no chip when idle/no trip; no visible UI change to any other screen.

## Out of scope (explicit)

- Reverse geocoding / place names on the chip
- Forecasts, hourly graphs, any multi-field weather surface
- Web dashboard weather (live map, trip drawer)
- Weather history persistence — weather is display-only context, never stored
- Any banner/promotion path for severe weather — permanently excluded by this plan

## Invariants — preserve unchanged

Current GPS, geofence, monitor, trip lifecycle, background tracking, responder tracking, authorization, and notification behavior. Do not commit.

## Related

[[Tracking]] · [[Mobile Architecture]] · [[Mobile Home Claymorphism Implementation Plan]] · [[Mobile Trips Claymorphism Implementation Plan]]

---

## Claymorphism Weather Pill Update — 2026-09-10

Owner request: "yung ui ng weather ay hindi naka claymorphism gawin mo nga" (apply claymorphism to the weather UI).

### Changes Implemented
- **`mobile/components/WeatherChip.js`:**
  - Upgraded the weather pill from flat elevation to full claymorphism aesthetics matching the Home header's clay avatar and notification bell.
  - **Clay Pill Edges:** Top white highlight (`borderTopWidth: 2`, `borderTopColor: '#FFFFFF90'` in light, diffused `rgba(255,255,255,0.12)` in dark) and bottom shade (`borderBottomWidth: 2.5`, `borderBottomColor: '#00000015'` in light, `rgba(0,0,0,0.38)` in dark) with strict dark/light key parity (`borderWidth: 0` vs `1`).
  - **Molded Icon Disc:** Weather icon now sits inside a tactile 30dp clay disc (`iconDisc`) with `mats.clayTile` styling and condition-adaptive tinting (`secondary` for sun, `info` for rain/night).
  - **Themed Elevation Shadow:** Soft elevation (`elevation: 4`, `shadowRadius: 8`, `shadowColor: colors.shadow`).
- **Verification:**
  - `npm test -- mobile/lib`: 14 suites / 104 tests passed.
  - ESLint clean (0 errors, 0 warnings).
  - Android Expo export passed (1,356 modules, 5.16 MB).


## Meteocons Icon Upgrade � 2026-09-13

Owner request: replace Ionicons weather glyphs with Meteocons (Fill static art, MIT � Bas Milius) while keeping chip behavior, layout, and compact UI.

- **Assets** (mobile/assets/images/weather/, +ATTRIBUTION.md): 12 curated keys � PNG @2x/@3x (44/66px; @1x set removed — no modern device uses it), rasterized once via resvg � zero new native deps, zero Metro config, offline-safe. No eact-native-svg in the tree, so SVG rendering was deliberately not introduced.
- **Derivation** (mobile/lib/weather-chip.js): WMO codes ? semantic keys (clear-day/night, mostly-clear-day/night, partly-cloudy-day/night, overcast, og, drizzle, ain, snow, 	hunderstorms); showers read as rain and snow showers as snow (no such art upstream � documented); fog now truthful (was cloudy); night override via truthful server is_day (Option A), day fallback when absent � never silence. Dead night-branch and outline/filled mixing eliminated; isNight kept in the model (map/index memo deps). Exports WEATHER_ICON_KEYS manifest.
- **Render** (mobile/components/WeatherChip.js): static equire map ? <Image> (18/20px, explicit dims); glyph tinting removed (full-color art carries its own colors � the one justified color change; temperature/label keep theme tokens); memo, disc, layout, null-render kept; a11y label speaks the key (clear day, partly cloudy night). Follow-up (owner: disc made the glyph feel small): the 30dp molded icon disc was removed — art renders directly in the row, sized up twice for visibility (18/20 → 26/28 → 30/32 compact/regular) with explicit dims, chip pill/shadow/layout untouched. Follow-up: the map standby card ((tabs)/map.js) rendered the same chip model through Ionicons, so once keys went semantic it warned "not a valid icon name" — fixed by consuming the shared exported METEOCON_ASSETS map (26px Image, hoisted lookup, layout untouched). Follow-up (owner: fixed-width card left dead space on short labels): dropped `width: '100%'` from `standbyWeatherCard` — card now hugs content up to the existing `maxWidth: 280` (long labels ellipsize as before). Follow-up fix: hug-width + `flex: 1` (basis 0) columns collapsed the text to zero width (icon-only card) — columns now use explicit `flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0` so they contribute intrinsic width yet still compress past the cap.
- **Server** (src/lib/weather.js): is_day added to the existing Open-Meteo current= call (same free request, same 2s budget); both routes pass through untouched.
- **Verification:** full Vitest suite 102 files / 1118 tests passed (incl. key-mapping + on-disk PNG asset tests); ESLint clean on all touched files; Android export passed. Dark-mode/device screenshot review pending.
