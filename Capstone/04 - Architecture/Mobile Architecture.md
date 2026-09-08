---
type: architecture
title: Mobile Architecture
tags: [architecture, mobile, expo]
source:
  - mobile/app/(app)/(tabs)/_layout.js
  - mobile/app/(app)/_layout.js
  - mobile/lib/api.js
  - mobile/lib/tracking.js
  - mobile/lib/rbac.js
  - mobile/lib/permissions.js
  - mobile/lib/connectivity-state.js
  - mobile/lib/connectivity-context.js
  - mobile/lib/sync.js
  - mobile/lib/offline-cache.js
  - mobile/components/ConnectivityBanner.jsx
  - mobile/app/(app)/profile/license.js
  - mobile/AGENTS.md
last_verified: 2026-09-08
---

# Mobile Architecture

Expo SDK ~54, expo-router ~6. **Drivers only.** A separate app with a separate auth system, not a wrapper around the web dashboard.

## Navigation — CONFIRMED (`mobile/app/(app)/(tabs)/_layout.js`)

| Route | Label |
|---|---|
| `index` | Home |
| `trips` | Trips |
| `vehicle` | Vehicle |
| `notifications` | Alerts |
| `profile` | Profile |

Three separate documents describe these tabs differently, all wrong. → [[DOC Mobile Tabs Documented Three Ways]]

## The API client is the most carefully-written file in the mobile app — CONFIRMED

`mobile/lib/api.js`: `TIMEOUT_MS = 15000`, `MAX_RETRIES = 1`, and a **single-flight refresh promise**. From its docstring:

> *"Without this, a screen firing three requests at once on a stale token would run three refreshes; because refresh is single-use and rotating, the first would succeed and the other two would present an already-revoked token and log the driver out."*

That is a precise description of a real race. The fix — one shared in-flight refresh promise that all callers await — is the standard solution, and the comment explains *why* it's needed rather than just what it does.

→ [[Token Rotation And Refresh Races]]

```mermaid
sequenceDiagram
    participant S1 as Screen A
    participant S2 as Screen B
    participant C as api.js
    participant API as /api/mobile/auth/refresh
    S1->>C: request (401)
    S2->>C: request (401)
    C->>C: refreshPromise ??= doRefresh()
    C->>API: ONE refresh call
    API-->>C: new access + new refresh (old revoked)
    C-->>S1: retry with new token
    C-->>S2: retry with new token
```

## GPS tracking — CONFIRMED

**Foreground** (`mobile/lib/tracking.js`):
- `watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })` writes to a ref
- A separate interval POSTs the latest fix every **30 s** to `/api/mobile/driver/trips/${tripId}/gps`

**Background** (`mobile/lib/background-tracking.js`, added 2026-08-19): a `expo-task-manager` task (`fleetops-background-location`) posts GPS and accumulates per-leg km while the app is backgrounded during an active trip. `map.js` starts it on background via `AppState` and stops + merges km on return, so the two never overlap (no double-counted km, no duplicate posts). The foreground watcher remains the source of truth. → [[ADR-011 Background GPS Tracking]]

**Decoupling the sensor from the upload is the right shape**: position updates arrive at whatever rate the GPS produces them, but network traffic is bounded at one request per 30 s.

Background tracking **requires a custom dev build** (not Expo Go) — see the "Version warning" note below — and Android production release needs Play Store review. The old foreground-only decision is superseded: [[ADR-010 Foreground Only GPS]] → [[ADR-011 Background GPS Tracking]].

## Client-side role decoding — CONFIRMED (`mobile/lib/rbac.js`)

`decodeJwtRole()` base64url-decodes the JWT payload **without verifying the signature**. The docstring is explicit:

> *"signature verification stays server-side, so this is for reading claims, not trusting them."*

This is correct practice, correctly documented: the client decodes to decide what to *render*; the server verifies to decide what to *allow*. A forged local token changes the UI and nothing else. → [[Client Side Role Decoding Is Not Security]]

## Auth

Separate from web — 15-minute access tokens, 30-day single-use rotating refresh tokens hashed in `mobile_refresh_tokens`, audience-split. Full detail in [[Authentication]].

## Profile screens share the web driver endpoint — CONFIRMED (`mobile/app/(app)/profile/*.js`)

The profile sub-screens (personal, license, safety, vehicle) call **`/api/driver/me`** — the same endpoint as the web driver home — not `/api/mobile/driver/me`. That is deliberate: `DRIVER_VISIBLE_SECTIONS` / `DRIVER_SELF_EDITABLE_FIELDS` live in `src/lib/consent/driver-visibility.js`, and both surfaces reading one response keeps web and mobile views identical. The mobile-native endpoint only covers identity + active trip. Full scan-upload flow: [[Driver Consent]].

## OS permission registry — CONFIRMED (`mobile/lib/permissions.js`)

All five device permissions (foreground/background location, camera, photo library, notifications) are declared once in a registry with normalized `{ status, canAskAgain }`. Both the onboarding gate and Settings → PERMISSIONS consume it; see [[Driver Consent]] for the full behavior. Background location is listed as its own row (Android's "Allow all the time" is distinct from "While using"; iOS has no separate toggle).

## Version warning — CONFIRMED

`mobile/AGENTS.md`: *"Expo HAS CHANGED — read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code."*

Same trap as [[Framework Version Drift]] on the web side.

**Dev-build implication:** background location ([[ADR-011 Background GPS Tracking]]) is not available in Expo Go — it needs a custom build. Since `expo prebuild --clean` on 2026-08-19, `android/` carries the background-location permissions and config, but the installed app on a device still needs a rebuild + reinstall.

## Connectivity UX — PR #3.1 (2026-09-08)

Driver-only global connectivity status, mounted once in `mobile/app/(app)/_layout.js` as a layout-participating sibling above the `Stack` (inside `ConnectivityProvider`, inside the existing `NotificationFeedProvider`). The layout's driver-session + consent guards redirect before it, so it never renders on login/consent/setup screens. It pushes content down — map controls and bottom tabs are never covered — and renders nothing when healthy.

- **Dependency:** `@react-native-community/netinfo@11.4.1` via `npx expo install` (SDK 54-compatible). No other new dependencies.
- **State model** (`mobile/lib/connectivity-state.js`, pure + unit-tested): `online | unstable | offline | syncing` from NetInfo reachability + API transport-failure evidence (≥3 in 60 s → unstable; `isConnected`/`isInternetReachable` false → offline). 401/403/5xx never count; one success decisively clears; isolated failures never flicker. Context exposes `{status, isConnected, isInternetReachable, pendingCount, lastSyncedAt, lastFailureAt, lastSuccessAt}` plus transient `phase` (`recovered`/`synced`).
- **Sequence:** healthy → invisible; trouble → "Connection unstable"; no internet → "You're offline" + "N queued" badge; offline with live trip tracking → "Offline · GPS still recording / Dispatcher may see your last synced location" (only when the poster is genuinely feeding the current trip — never inferred); recovery → "Back online" + "Syncing N updates…"; queue drained to zero → "All updates synced" → auto-dismiss.
- **Queued-action UX:** `wasQueued()` helper (`mobile/lib/api.js`); trip transitions and completions that land in the outbox announce "Saved for sync / This update will be sent when you're online" instead of implying server confirmation. Advance/queue mechanics unchanged. Screens that already branched on `{queued:true}` (SOS, fuel, inspection, incidents) untouched.
- **Dedup follow-up:** Home + Trips list `load()` catches suppress inline `ErrorNotice` for transport failures only (`isTransportFailure`, now housed in the pure `connectivity-state.js` and re-exported from `api.js`) — the global banner already speaks for them. Genuine errors still surface; stale lists stay visible offline.
- **Reconnect auth hardening (driver-reported transient "session" warning, never an actual logout):** refresh POST retries once on transport failure (server 1-min grace covers the duplicate); 429 from refresh throws retryable instead of `clearAll()` + logout; a replay that 401s after a rotation gets one more refresh+replay before surfacing. Covered by `mobile/lib/api-refresh.test.js` (burst single-flight, second chance, 429-no-logout, refresh retry ×2).
- **Cold-start tolerance:** Home + Trips `load()` auto-retries once (1.5 s) for transient failures via pure `shouldAutoRetry` (transport, 401, 429, 5xx — never 400/403/404) before showing anything. The manual Retry tap the driver used to need is now automatic.
- **Forced-logout root cause (DB forensics 2026-09-08):** one family showed 63 rotations then a full wipe — the foreground poster and the background GPS task run in SEPARATE JS contexts with independent single-flights, alternating grace-rotations until one landed outside grace. Fix: `ROTATION_COOLDOWN_SECONDS = 10` in POST `/api/mobile/auth/refresh` — a family rotated seconds ago gets a stateless 429 with zero writes (covered by `refresh/route.test.js`: cooldown 429, normal rotation, genuine-replay wipe pinned).
- **429 silence follow-up (driver-visible "too many requests" on Home):** both 429 paths now carry `retry_after`; the client waits once per the hint (cap 10 s) and retries once silently — only a second consecutive 429 surfaces, session intact. Covered by `api-refresh.test.js` (+2). Full suite 714 passing.
- **Untouched:** trip lifecycle, auth/refresh/queue semantics, GPS lifecycle, PR #1–#3 logic, geofence rules. Tap detail sheet deferred.
- **Verified:** `connectivity-state.test.js` (8), full suite 686 passing, eslint warning-clean, `expo export -p android` bundles 1333 modules. Physical-device checklist (airplane-mode, drain, dark mode, map overlap, background→foreground) still requires a device — not claimed.

## Offline Read Mode (2026-09-08)

Stale-while-revalidate for the 6 core driver screens in one PR: Trips, History (shares the Trips `TRIPS_ALL` snapshot), Trip Detail (list-cache-first + per-trip `trip:{id}` key), Work Schedule (days/leaves/balances cached independently — one failing never blanks the rest), Activity Logs (submissions + inspections cached independently, rejected sources keep prior state instead of blanking to `[]`), Home (`HOME_TRIPS` + `DRIVER_ME`).

- **Foundation** (`mobile/lib/offline-cache.js`, no new dependencies): entries are `{ data, syncedAt }`, no TTL — last-good kept indefinitely. Every cache call takes an explicit `driverId` (`resolveDriverId`: `employeeId ?? driverId ?? employee_id ?? id ?? driver_id`); the module never imports storage/auth, so no circular dependency. Logout/session-death order is remember-driverId → `clearOfflineCache(driverId)` → `clearAll()` (orchestrated in `auth.js signOut` and a `clearSession()` helper in `api.js` covering both refresh-failure paths) — driver B on a shared phone never sees driver A's trips.
- **camelCase namespace bug (fixed 2026-09-08, same day):** the login route returns `{ driverId, employeeId, … }` camelCase and `signIn` stores it verbatim, but `resolveDriverId` checked only snake_case — it returned null for every real login, so the cache was never written NOR read on any screen (and `clearOfflineCache` was dead code). The unit tests fed snake_case shapes only, which is exactly how it slipped through. Fix: camelCase first (employeeId preferred — stable server identity matching the logout/login namespace), snake_case kept as fallback for hand-shaped fixtures. Regression-pinned by a test using the exact login-response shape. Lesson: when a resolver dispatches on payload shape, test it against the *wire* shape it actually receives, not the shape you imagined.
- **4-state offline UX (all 6 cached screens, shared implementation):** logic in the pure, unit-tested `mobile/lib/offline-ux.js` (`offlineViewState` for single-source screens; `combineOfflineSources` for multi-source), visuals in `mobile/components/OfflineStates.jsx` (`SyncNote` + `SavedChip` + `NeverSyncedCard`) — the same two pieces every screen consumes, work-schedule.js included (its local styles were folded into the shared components). State table (locked):
  - **data** (items exist) → normal; offline → one inline "Using your last synced {label} for offline access." note + `Saved · {age}` chip. ONE note per screen, never per row/bucket.
  - **empty-confirmed** (`syncedAt != null`, zero items — the server answered, even with `[]`) → online: "No X assigned right now."; offline: "No X were assigned when last synced." + Saved chip — a snapshot is not a current-truth claim.
  - **never-synced** (offline, `syncedAt == null`) → dedicated `NeverSyncedCard` ("Connect once…"), never rows/skeletons/fabricated shells pretending to be data.
  - **empty-unconfirmed** (ONLINE, `syncedAt == null` — fetch never confirmed) → "X couldn't be confirmed right now. Pull to refresh or try again." — never "Connect once", the device IS connected.
  - **partial** (multi-source only: some sources answered, some not) → "Some offline activity may be unavailable. Reconnect to refresh all activity logs." — one unanswered source forbids a confirmed-empty claim.
  - Honesty rules: confirmed-empty keys off per-source `syncedAt`, NEVER item count or a screen-wide `Math.min()`; filter-empty (data exists, active filter yields zero) is decided before the helper and keeps filter copy; `status: "unstable"` is treated as online (the amber banner speaks for it).
  - **Home hero correction:** "All clear / ready for new assignments" keys off `tripsSyncedAt` (HOME_TRIPS) alone — a cached DRIVER_ME profile proves nothing about assignments. Offline never-synced renders "No saved trips yet / Connect once…" with an Offline chip; offline confirmed-empty reads "All clear when last synced".
  - **Trip Detail:** offline + never-synced now renders `NeverSyncedCard` ("Trip not saved for offline") instead of the old fabricated `{trip_status: "Completed"}` shell. The ONLINE not-found fallback still fabricates that shell — logged as a follow-up in [[Current State]], out of this slice.
- **Staleness lives in the one global banner** (`mobile/components/ConnectivityBanner.jsx` reads the existing `lastSuccessAt` from `useConnectivity()` and formats it with the shared pure `formatLastSynced()`): offline → "Last synced {12 min ago / 3h ago / yesterday at 4:32 PM} · Showing saved data. Updates will sync automatically." (GPS variant keeps its recording copy + age; unstable appends age; never-synced sessions keep the generic copy). No per-screen badge — an earlier `OfflineCacheBadge` was removed for stacking a redundant second banner under the global one. Never-synced devices get a "connect once" empty state per screen instead of a blank page.
- **Authority safeguard (locked):** cache is display-only — it fills the same state the network would have, all trip gates/RBAC/server validation run unchanged. Offline actions still queue via `wasQueued()` → "Saved for sync"; server accept/reject on reconnect stands.
- **Offline driver context (2026-09-08, same-day follow-up):** Report Incident, Fuel Report, and Profile > Assigned Vehicle all need "what vehicle am I driving", but each did its own live fetch with a silent catch — offline meant a silently missing vehicle (and incidents.js used a **recent trip's** vehicle as fallback, which is not proof of a current assignment). Two new shared pieces:
  - `mobile/lib/driver-context.js` — pure resolver `resolveVehicleContext({ trip, trips, me, activeStatuses })` with the locked priority chain: **explicit trip → active trip vehicle (genuinely in-progress statuses) → standing assignment (`me.assignedVehicle`) → null** — NEVER a recent/finished trip's vehicle. `getCachedVehicleContext(driverId)` reads the caches the core screens already write (TRIPS_ALL, falling back to HOME_TRIPS, + DRIVER_ME), no network, never throws. Shape tolerance: trip rows and `/api/mobile/driver/me` are snake_case, `/api/driver/me`'s assignedVehicle is camelCase — both accepted and both pinned by wire-shape tests (`driver-context.test.js`, 12 tests, incl. the finished-trip anti-pattern). incidents.js and fuel-report.js now apply the cached resolution first, then revalidate live and re-warm the cache on success; fuel keeps its own non-terminal selection semantics (denylist of Completed/Cancelled) in both paths so offline and online pick the same vehicle.
  - `mobile/lib/driver-profile.js` — `useDriverProfile()` hook: cached DRIVER_ME read first, live `/api/driver/me` revalidate, cache write on success; on failure the cached profile stays and `onError` fires ONLY in the never-synced case. Consumed by the Profile tab and all four sub-screens (Personal Information, License & Compliance, Assigned Vehicle, Safety Settings) — replacing five copies of the same fetch+alert pattern. Personal Information no longer errors offline; the phone PATCH still requires a connection and refreshes the cache via `reload()` on success.
  - **UX rule (locked): Profile/Settings screens are SILENT about caching** — no SyncNote, no Saved chip, no never-synced card. The global connectivity banner is enough. Trips/Schedules/Logs need freshness indicators because they change operationally; a driver's own name/plate/license do not. Settings is device-local and works offline by nature (untouched). Server-dependent pages outside Profile (e.g. Logged-in Devices) are a separate slice.
- **Untouched:** write queue/retry semantics, incidents list, notifications history, map tiles, image bytes, GPS lifecycle, Settings screen.
- **Verified:** `offline-cache.test.js` (12) + `offline-ux.test.js` (9: single-source decision table incl. the online-empty-unconfirmed distinction, multi-source combiner incl. the partial state) + `driver-context.test.js` (12) — full mobile suite 65 passing, eslint warning-clean on all touched files, `expo export -p android` bundles clean (5 MB Hermes). Physical-device checklist (airplane-mode persistence across kill/relaunch, shared-phone driver switch E2E — the cross-driver clear is only now actually exercisable since resolveDriverId was null before) still requires a device — not claimed.

## Related

[[Authentication]] · [[Tracking]] · [[Token Rotation And Refresh Races]] · [[Trips]] · [[Architecture]] · [[Driver Management]]
