---
type: reference
title: Components
tags: [codebase, frontend, components]
source:
  - src/components
  - src/hooks
  - mobile/components/ui.js
last_verified: 2026-08-26
---

# Components

## Web — CONFIRMED

`src/components/ui/` holds Radix UI primitives (17 packages) wrapped in the **shadcn/ui** pattern: the primitive provides behaviour and accessibility, the local wrapper provides Tailwind styling. The components are copied into the repo rather than installed, so they are yours to edit.

- `ThemeToggle` (`src/components/ui/theme-toggle.jsx`): Reversible animated light/dark toggle. Features continuous spring-based orbit micro-interactions (Sun $\leftrightarrow$ Moon rotations and scale transforms) that smoothly reverse when clicked back.
- `NotificationCard` (`src/components/notifications/notification-card.jsx`): Enterprise minimalist notification card. Replaces full-card tinted gradients with a crisp neutral white surface (`#ffffff`, `dark:bg-slate-900/90`), subtle border (`#d7dee7`), 22px rounded corners, left 56x56 semantic squircle medallion (`#fdebed` for alerts/repairs, `#f9f1e3` for maintenance due warnings), unread royal blue dot, uppercase pill badge with hairline divider, and top-right circular action pair (acknowledge check button and delete trash button). Supports `compact={true}` mode for dropdowns and dashboard widgets.

Styling is **Tailwind v4** — CSS-first. There is no `tailwind.config.js`; theme tokens live in CSS via `@theme`. Coming from v3, that's the main surprise.

Feature components sit alongside the pages that use them under `src/app/(dashboard)/…`.

## Hooks — CONFIRMED

`src/hooks/` wraps TanStack Query. The convention: a hook owns the query key and the fetch, and a component owns rendering. That keeps cache invalidation in one place — when a dispatch is created, the hook that owns the dispatch list is what knows to invalidate.

## Mobile — CONFIRMED

`mobile/components/ui.js` — a **single file** of shared UI, not a directory. Appropriate for a five-screen app; worth splitting if it grows.

### Mobile premium primitives (added 2026-08-16)

- `PulsingDot` — infinite soft pulse for genuinely live state only (e.g. active trip). Follows the "pulse only for a live state" rule; never for static records.
- `CountUpText` — animates a small figure from 0 to `value` on mount (dashboard stats). Numbers only, no decorative counters.

Both use RN `Animated` with `useNativeDriver` where possible; no new animation dependency.

### Mobile auth brand block (added 2026-09-24)

- `mobile/components/auth/AuthHeader.jsx` — the shared FleetOps auth brand
  block: `<AuthHeader icon={string} title={string} tagline={string} />`
  renders a `ClayTile size="lg"` + title + tagline, and deliberately **no back
  button** (screens keep their own above it). Extracted from the block that
  was duplicated byte-for-byte across `login.js`, `forgot-password.js` and
  `reset-password.js`; consumed by the OTP redesign's `OtpVerificationView`.
  `appName`/`tagline` carry `textAlign: "center"` (deliberate — a wrapped
  tagline centres under the centred title). Verified: mobile lib suite
  34 files / 389 tests unchanged; ESLint `--max-warnings 0` clean. See
  [[Mobile Architecture]].

## The import hazard

Client components import from `src/services/`, which also contains server-side modules that reach for `@/lib/db` and the **service role key**. Importing the wrong one into a client component pulls privileged code toward the browser. → [[DEBT Services Folder Mixes Two Concerns]]

**TODO:** grep client components for any transitive import of `@/lib/db` as a smoke test.

## Related

[[Frontend]] · [[Codebase Map]] · [[Technology Stack]] · [[Mobile Architecture]]

---

## DataTable - server-side pagination (added 2026-08-16)

`src/components/tables/data-table.jsx` is the shared list/table used by most dashboard
pages. It supports two modes:

- **Client mode (default):** `getSortedRowModel` / `getFilteredRowModel` /
  `getPaginationRowModel` sort, filter, and paginate in the browser.
- **Server mode (`manualPagination`):** skips the client models; the parent owns
  paging/filtering/sort and passes `data` (current page), `pageIndex` / `onPageChange`,
  `rowCount`, `onSortChange`, and controlled `searchValue` / `onSearchChange`. The page
  puts those in its React Query key so each change refetches one page from the API.

Use server mode for large tables; the pilot is the Trips list (see `trips/page.js`).
Replicate the same pattern (`manualPagination` + query-key params + `keepPreviousData`)
to the other big lists (drivers, vehicles, fuel, incidents, dispatch, reservations,
routes, audit) to keep downloads to one page instead of the whole table.

---

## StatusBadge is THE central status grammar (synced 2026-08-23)

`src/components/ui/status-badge.jsx` owns one severity grammar for the whole
dashboard: **danger = act now, warning = act this cycle, info = watch,
success = healthy, primary = in motion/emphasis, secondary = neutral.**

- `ENTITY_MAPS` holds per-entity vocabularies (`vehicle`, `driver`, `trip`,
  `reservation`, `fuel`, `dispatch`, `route`, `maintenance`, `priority`,
  `incident`, `leave`, …), keyed by the exact DB CHECK strings lowercased.
  The trip map covers all 16 `TRIP_STATUS` values; dispatch includes
  "pending reassignment" → danger.
- `GLOBAL_STATUS_MAP` is only a fallback for entity-less calls. Entity maps
  win: `lookup()` tries the entity map first, so known contradictions
  (global `cancelled` = danger vs neutral secondary lifecycles, global
  `high` = danger vs `priority.high` = warning) never leak into entity badges.
- Pages must NOT keep local shadow maps. FleetTable/FleetGrid, driver detail,
  fuel, and routes all render statuses through `<StatusBadge entity="…" />`
  so the same status colors identically everywhere.

## ConfirmDialog canonical props (synced 2026-08-23)

Call sites use `message=` / `confirmLabel=` / `loading=` / `variant=`.
Aliases (`description`, `confirmText`, `isLoading`, `variant="danger"`)
still work but are legacy. Archive flows use `variant="archive"`
(warning icon), destructive deletes use `"destructive"`, informational
confirmations use `"info"`.

---

## Web component inventory — September additions (synced 2026-09-17)

Full visual contracts live in `DESIGN.md` (re-synced 2026-09-17, web-only
scope). Shipped since the August audit, all verified against source:

- `stat-card.jsx` — base vs interactive (`href`/`onClick`) variants,
  `valueNote` pill, `trend` caption, destination `aria-label` + focus ring
  on linked cards.
- `role-dashboard.jsx` — `Panel` (inset highlight + header rhythm),
  `FeedState` (skeleton / named `role="alert"` / honest empty), `DonutMeter`
  (partitions-only, fills from `chart-tokens.js`), `DistributionMeter`
  (`role="img"` + text summary), `StatusBars` (overlapping counts),
  `LivePulseBeacon` (live-critical rows only), `Row` (`line-clamp-2`,
  `min-h-16` touch rows).
- `operations-cards.jsx` — Request Journey lifecycle flow visualization
  (`RequestPipelineCard`: Zero-scroll responsive dual-mode architecture. On desktop screens (>=1024px, `hidden lg:block`),
  renders a fluid 7-column CSS Grid (`grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]`) spanning Row 1 (Pending → Assigned → In Progress → Completed)
  and Row 2 (`FulfillmentPerformanceCard` [col-span-3, On-time rate & Fulfillment rate] + curved Bezier branch connector [col-span-1, `d="M 0 -120 L 0 45 C 0 85, 30 96, 64 96"` with non-overlapping top-right metrics] + Cancelled card [col-span-1, directly beneath In Progress] + spacer [col-span-1] + `CancelledCallout` [col-span-1, directly beneath Completed])
  with unified `h-[192px]` heights, unclipped `h-8` footer pills, and zero horizontal scrollbar on any desktop monitor.
  On mobile and tablet viewports (<1024px, `block lg:hidden`), collapses seamlessly into a vertical phase rail / stepper with full-width cards (`w-full`),
  downward conversion badges (`↓ {percentage}% to {toLabel} ({count})`), dedicated Exception Branch section with callout, and responsive
  `FulfillmentPerformanceCard`, eliminating awkward horizontal drag-scrolling; Volume vs Conversion % segmented control; Scheduled aggregated into Pending;
  MANDATORY footers: "Needs assignment", "Driver + vehicle secured", "On the move", "Arrived successfully", "Request withdrawn"), Document Compliance card (`DocumentComplianceCard` compact single-column
  redesign: 2-tier layout featuring summary panel + pure SVG `DocumentDonutChart` top tier,
  4 colored stat cards middle tier, and bottom Expiring Soon row), Fleet Asset Readiness
  (`FleetReadinessCard`: dual-zone operational posture for vehicle fleet and driver workforce with
  segmented progress meters, 4 status chips each, and live dispatch capacity beacon),
  Maintenance Pressure (`MaintenancePressureCard` double-bezel modernization with amber squircle badge
  and status-colored work orders), Incident Risk (`IncidentRiskCard` double-bezel modernization with
  rose squircle badge, 4 severity tiles, and calm/alert hero panel).
- `role-dashboard.jsx` — Admin Dashboard balanced 2x2 grid architecture: Row 1 full-width
  `RequestPipelineCard` with integrated fulfillment SLA card, Row 2 paired `DocumentComplianceCard`
  and `FleetReadinessCard`, Row 3 paired `MaintenancePressureCard` and `IncidentRiskCard`. Configured in
  `dashboard-configs.js` with `vehicles`, `drivers`, and `driverStats` queries. Also provides `Panel`,
  `FeedState`, `DonutMeter`, `DistributionMeter`, `StatusBars`, `LivePulseBeacon`, `Row`.
- `ai-analyst-card.jsx` — sky squircle + navy "Intelligence Engine" pill,
  inset contour-wave panel, report-identity-matched narrative, numbered
  recommended actions.
- `maps/map-entity-marker.jsx` — 30px pin + card anatomy, six-tone grammar,
  z-index scale (critical 2500 → stale 400), pulse-only-critical,
  `MinimalMapLegend`.
- `ui/page-entrance.jsx` — one 0.6s fade-up per page (`CARD_SHADOW`
  shared by record-creation pages).
- `ui/caps-lock-hint.jsx` + login lockout countdown + session-expired
  banner — quiet hint semantics (`aria-live`, never blocks submit),
  enumeration-safe lockout peek, peach one-off surface.
- `auth/session-countdown.jsx` + `lib/auth/countdown.js` — always-on idle
  readout in the `TopNav` cluster (`role="timer"`, `aria-live` off by
  default), plus the shared `formatCountdown` / `formatCountdownSpoken` /
  `countdownTone` used by both the chip and `session-expiry-modal.jsx`.
  Ticking state is held in the chip, never in the shell, so the rest of
  `TopNav` does not re-render once a second.
