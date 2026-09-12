---
type: moc
title: System Overview
tags: [moc, system, architecture]
source:
  - docs/architecture/sub-system-integration.md
  - src/lib/integration/contracts.js
  - package.json
  - SYSTEM.md
last_verified: 2026-08-11
---

# System Overview

## What Fleet Transpo is — CONFIRMED

A **fleet & transportation management sub-system** for a single-organization hotel operation.

It is **not** a standalone ride-hailing app. It sits downstream of a parent **Booking/PMS subsystem**: Booking sends transportation requests; Fleet decides vehicle, driver, schedule, and execution, then reports status back.

**Evidence:**
- `docs/architecture/sub-system-integration.md` — the data-ownership matrix
- `src/lib/integration/contracts.js` — Zod schemas that *are* the boundary contract
- Live `system_settings.hotel_location` = `"CoCo Star Hotel, Manila, Philippines"`

**Context — CONFIRMED:** `package.json` names the project `capstone`. This is academic thesis work, which explains the demo-scale data and the test-harness pollution in `employees`.

## The problem it solves

A hotel receives guest transportation requests. Someone must decide *which vehicle*, *which driver*, *when*, without double-booking a resource, dispatching an expired-registration vehicle, or violating Manila's number-coding law. Fleet Transpo is that decision system, plus the execution tracking around it.

## Users — CONFIRMED (live `roles` table)

| Role | ID | Home | What they do |
|---|---|---|---|
| `system_admin` | 1 | `/dashboard` | Everything; short-circuits the permission matrix |
| `fleet_manager` | 2 | `/dashboard` | Vehicles, drivers, maintenance, documents |
| `dispatcher` | 3 | `/dashboard` | The queue: review, approve, assign, dispatch |
| `driver` | 4 | `/driver` | Own trips only; primary user of the mobile app |
| `management` | 7 | `/dashboard` | Read + analytics; explicitly denied lifecycle verbs |
| `admin` | 9 | `/dashboard` | Admin operations |

Six roles. See [[RBAC]] — and note [[DOC rbac-model Says 9 Roles]], because the "authoritative" doc disagrees.

## Major business processes — CONFIRMED

1. **Request intake** — pull or push from Booking → [[Reservations]]
2. **Triage** — priority derivation + conflict detection in the queue
3. **Approval** — review → approve/reject
4. **Assignment** — vehicle + driver as a pair → [[Dispatch]]
5. **Execution** — trip start → GPS → complete → [[Trips]]
6. **Reporting back** — outbound status to Booking → [[System Boundaries]]

Cross-cutting: [[UVVRP Number Coding]], [[Fuel]], [[Maintenance]], [[Notifications]], [[AI Advisory]], [[Live Map Radar]].

## Two clients — CONFIRMED

| Client | Stack | Auth | Users |
|---|---|---|---|
| Web dashboard | Next.js 16.2.11 App Router, React 19.2.4 | NextAuth v4 cookie/JWT | 5 staff roles |
| Mobile | Expo SDK ~54, expo-router ~6 | Separate bearer JWT | drivers only |

Two independent auth systems by design. See [[Authentication]].

## Scale — CONFIRMED (live query 2026-08-11, after Phase 3)

38 tables + 1 view · 77 FKs · 113 API routes · 61 pages · 30 service modules · 43 migrations · 16 test files.

**Demo-scale data:** 20 vehicles, 23 drivers, 15 requests, **2 trips, 2 dispatches**. Biggest table is `ailogs` (731 rows on 2026-08-11, and unbounded — it grows on every AI call). 29 of 47 employees are soft-deleted harness accounts.

INFERRED: the system is feature-complete in breadth but lightly exercised in depth. 10 tables have zero rows — was 11, and the eleventh was dropped rather than filled.

## The one thing to understand first

**Authorization is application-layer. RLS is inert.** Both database paths hold elevated privileges, so RLS policies never fire despite being enabled on 32 tables. Every security guarantee comes from `requireAuth()` in `src/lib/api/utils.js`.

Read [[Why RLS Is Not A Boundary]] before touching anything security-related.

## Related

[[Architecture]] · [[Technology Stack]] · [[System Boundaries]] · [[Data Flow]] · [[Feature Index]] · [[Home]]

## Changelog

- 2026-09-09: mobile live map Drop-off infinite-loading fix (escaped WebView popup labels, MAP_READY-before-theme, 20 s overlay / 15 s GPS fail-opens) → [[Tracking]]
- 2026-09-09: arrival gates — At Pickup / Passenger Onboard (pickup geofence) and Drop-off (destination geofence) enforced in `setTripStatus` with override-with-reason; swipe in-flight lock; new pickup-check endpoint + trip/override screen → [[Tracking]]
- 2026-09-09: merge radar branch — Live Map Radar idle mode coexists with arrival gates + clay/loading fixes (kept radar idle HUD/markers/ref API, kept gate pre-checks + fail-open timers, re-applied label escaping to the radar origin-marker block, MAP_READY-first retained) → [[Live Map Radar]]
- 2026-09-09: Home-consistency pass — Trip Details, Live Map sheets and Profile logout tile aligned to the Home clay language (pill dots, clayCta/CTAs, card radii, token colors); logic/navigation untouched → [[Mobile Trips Claymorphism Implementation Plan]]
- 2026-09-09: map smoothness pass — parked GPS bail-out, camera easeTo throttle, quantized radar rebuilds, stable WebView props, gated poll, materials cache, memoized subtrees → [[Tracking]]
- 2026-09-10: universal molded inset claymorphism — replicated Home notification bell tactile dual-pass boxShadow (warm amber ambient drop-shadow + inset specular highlight) across all shared primitives (ClayTile, ClayCard, ClayButton, ClayBadge, ClayInput) and WeatherChip; 16 test suites (112 tests) passing → [[UI UX Audit - Mobile]]
- 2026-09-10: mobile tab-bar crash fix — `(tabs)/_layout.js` scan FAB used undefined `raised`; now `raisedControl(isDark)`; ESLint clean → [[UI UX Audit - Mobile]]
- 2026-09-10: supplied compact system-architecture HTML rendered to `docs/output/CAPSTONE-FIGURES/fleetops-system-architecture-compact.png` with headless Chrome at the measured 1200×1064 screen viewport; full figure visually verified with no clipping.
- 2026-09-10: created the non-destructive 1365×2048 (2:3 portrait) derivative `docs/output/CAPSTONE-FIGURES/fleetops-system-architecture-compact-1365x2048.png`; the full landscape figure is preserved with centered white vertical margins rather than distortion or cropping.
- 2026-09-10: added a portrait-fit 1365×2048 derivative `docs/output/CAPSTONE-FIGURES/fleetops-system-architecture-compact-1365x2048-fit.png`; cards reflow into a portrait grid so the canvas is filled while text proportions remain natural.
- 2026-09-10: quick-action responsiveness plan — all 6 tasks done (T1 press feedback 43a9704; T2 idle route prefetch 0e01ca6; T3 deferred Home refetch 64c38e7; T4 deferred Schedule/Log revalidation 38124c3; T5 deferred Fuel network + lazy camera 76ffc5b; T6 verification: release export 1359 modules / 5.15 MB hbc, vitest 17 files / 107 tests PASS, ESLint clean; on-device tap→skeleton timing still pending — no Android target in this environment) → [[UI UX Audit - Mobile]]
- 2026-09-10: mobile tab order fix — Trips had no `Tabs.Screen` entry so expo-router auto-registered it icon-less and out of order; added explicit entry (navigate icon) for order Home → Live Map → [scan] → Trips → Profile; History/Notifications/Vehicle stay hidden; ESLint clean, export 1365 modules / 5.13 MB → [[Mobile Architecture]]
- 2026-09-12: removed the Home hero `Ready for what’s next?` headline (`DriverHeroCard` header is now date + subtitle only; unused `heroTitle` style and hero `offline` prop removed) → [[Mobile Home Claymorphism Implementation Plan]]
- 2026-09-12: shrunk the Home hero KPI cards ~20% (icon tiles 44→36, numbers 32→26, tighter padding/radii/gaps; content and handlers unchanged) → [[Mobile Home Claymorphism Implementation Plan]]
- 2026-09-12: Home trip section is now status-driven — conditional current card pinned first only when active, up to 3 chronological upcoming cards (`NEXT TRIP` + `UPCOMING`, `+N more` past cap) under `Upcoming Trips`; no empty placeholder slots, truthful confirmed/unconfirmed/offline empty copy kept; no backend change → [[Mobile Home Claymorphism Implementation Plan]]
- 2026-09-12: added `map.png` 3D-map scenery to the Next/Upcoming empty state (center-right, text keeps left; current-card empty untouched) → [[Mobile Home Claymorphism Implementation Plan]]
- 2026-09-12: updated driver floating SOS button to use uniform symmetric 1.5px soft rose borders and centered `#FFF0F0` gradient (`#FFF0F0` -> `#FFDADA` in light mode, `#3D1B1E` -> `#241012` in dark mode), resolving border overhang ("lumalampas") and pale uncolored top-rim artifacts across light and dark modes → [[Incidents]]
- 2026-09-12: hid the driver SOS FAB on Devices & Sessions (`/devices`) — the FAB stayed mounted when Stack screens pushed over the tabs and reappeared there because `/devices` was missing from the hide list (now the `HIDDEN_ROUTE_PREFIXES` constant in `DriverSos.js`) → [[Incidents]]
- 2026-09-12: executed the full Mobile Clay Bugfix plan — 8-file `isDark` derivation fix (incl. newly found `work-schedule.js`/`submissions.js`), trip-status and license badges route through `tone` (amber stays amber), `headlineMd` plate label, numeric `ClayTile` sizes, restored MISSION COMPLETE dot, dead `dotColor` cleanup, TripCard hook hoist, static-preview loading state, `RouteTimeline` undefined guard; lint + 117 lib tests pass → [[Mobile Clay Bugfix Implementation Plan]]
- 2026-09-12: optimized Quick Actions navigation responsiveness — wired idle route prefetch (`QUICK_ACTION_ROUTES`), deferred focus revalidation (`shouldRevalidateHome` + `runAfterInteractions`), off-transition network revalidation in destination screens (`work-schedule.js`, `incidents.js`, `fuel-report.js`), and smooth `LayoutAnimation` on panel expansion → [[UI UX Audit - Mobile]]


