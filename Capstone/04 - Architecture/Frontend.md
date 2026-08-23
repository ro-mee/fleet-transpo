---
type: architecture
title: Frontend
tags: [architecture, frontend, react, nextjs]
source:
  - src/app
  - src/components
  - package.json
last_verified: 2026-08-11
---

# Frontend

**61 pages** under `src/app/`, Next.js 16 App Router, React 19.2.4.

## Route groups — CONFIRMED

| Group | Audience |
|---|---|
| `(dashboard)/` | The five staff roles — fleet, drivers, dispatch, reservations, reports, settings |
| `(driver)/` | Driver web portal, mirroring part of the mobile app |
| `(auth)/` | Login |

Route groups `(name)` don't appear in the URL — they exist to give each audience its own layout.

## Data layer — CONFIRMED

| Concern | Library |
|---|---|
| Server state, caching, refetch | `@tanstack/react-query` |
| Tables (sort/filter/paginate) | `@tanstack/react-table` |
| Forms + validation | `react-hook-form` + `zod` via `@hookform/resolvers` |
| Client-only state | `zustand` |

**`zod` is used on both sides** — the same validation library that defines the integration contract validates the forms. Worth noticing: one schema language across the whole stack.

## UI — CONFIRMED

Radix UI primitives (17 packages) in the shadcn/ui pattern: unstyled accessible primitives wrapped in local components under `src/components/ui/`. Styling is **Tailwind v4**, which is **CSS-first** — there is no `tailwind.config.js`; configuration lives in the CSS via `@theme`. That trips people up coming from v3.

Charts: `recharts`. Maps: `leaflet` + `react-leaflet`. Motion: `framer-motion` (first used on the login surface, 2026-08-15).

**Add / Create page pattern (standardized 2026-08-17):** every record-creation page
uses the shared `HeroHeader` (`src/components/ui/hero-header.jsx`) as its top bar —
inverted-theme hero panel, icon, title, badge, description, and `Cancel`/primary
action buttons using the exported `heroButtonOutlineClass` / `heroButtonPrimaryClass`.
Below it, form sections live in `Card` components styled `rounded-3xl overflow-hidden`
with the floating `CARD_SHADOW` and a `bg-muted/20` header row
(`pb-3.5 border-b border-border/60`). Two shared primitives round it out:
`PageEntrance` (`src/components/ui/page-entrance.jsx`) fades the whole page up on
mount with the app's `[0.32,0.72,0,1]` ease under `MotionConfig reducedMotion="user"`,
and `StickyActionBar` (`src/components/ui/sticky-actions.jsx`) re-floats the same
Cancel/Save actions (automatically converting the inverted header classes to standard,
readable button styles for the non-inverted bottom bar) into a glass pill fixed to the bottom once the hero scrolls out
of view (IntersectionObserver sentinel, no scroll listener) — long forms never lose
their save button. `FloatingField` inputs get a soft primary focus ring.
Applies to `settings/users/new`, `reservations/new`, `drivers/new`,
`fleet/vehicles/new`, plus the shared `edit` variants of the last two.

**Form controls (same date):** all floating controls in `src/components/ui/field.jsx`
share a single double-bezel `FloatingShell` — an outer tray (`p-[5px]`,
`bg-gradient-to-b from-border/70 to-border/30`, `ring-1 ring-border/70`) wrapping an
inner `bg-surface` core with a hairline inset highlight (`rounded-[11px] min-h-[42px]`,
`shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]`); focus promotes the ring to the
primary hue with a soft glow, and `error` drives a `danger` ring + `AlertCircle` message.
The floating pill label bridges the seam. `FloatingSelect` is the dropdown variant —
`appearance-none` select with a lucide `ChevronDown` indicator — used for every raw
`<select>` across the add pages (source system, category, priority, sex, license class,
duty/vehicle status, role). `DatePicker` and `DateTimePicker` triggers use the same
double-bezel tray for visual consistency.

Auth surfaces (`(auth)/`) render without the dashboard chrome (the `DashboardLayout` short-circuits for those routes) and carry a premium editorial-split presentation: a branded left panel with animated route-line artwork plus a double-bezel form card. Motion respects `prefers-reduced-motion` via `MotionConfig reducedMotion="user"`; entrance states are rendered identically on server and client so hydration is safe.

**Theme switching (standardized 2026-08-23):** `use-theme.js` uses the modern **View Transition API** (`document.startViewTransition`) paired with a CSS `clip-path: circle(...)` animation on `::view-transition-new(root)`. When a user toggles light/dark mode (or picks an explicit mode in `/settings/general`), the incoming theme dynamically expands outwards in a hardware-accelerated circular reveal originating directly from the button click coordinate (`(clientX, clientY)` or element rect) across 450ms (`cubic-bezier(0.22, 1, 0.36, 1)`), smoothly covering the screen with no flash. Automatically degrades to instant toggle for environments without View Transitions or when `prefers-reduced-motion: reduce` is detected.

## Empty and missing routes — CONFIRMED

| Path | State |
|---|---|
| `/maintenance` | Full CRUD register — was `/fleet/maintenance`, relocated by `9c69f08` (2026-07-30) |

The standalone `/fleet/availability` and `/drivers/availability` boards (Phase 4, 2026-08-12) were **removed 2026-08-15**: availability is answered by schedule-overlap (see [[Fleet And Vehicles]] and [[Dispatch]]), and their nav entries were dropped from `workspaces.js`. The shared `StatusBoard` component is likewise no longer wired to a page.

The empty `src/app/(dashboard)/fleet/maintenance/` directory left behind by that
relocation was removed 2026-08-12.

## How the frontend talks to the backend

Through `src/services/*.service.js` **client fetch wrappers** — thin `apiFetch()` calls. But that same folder also holds server-side domain services, which is a real hazard: importing the wrong one into a client component pulls `@/lib/db` toward the browser. → [[DEBT Services Folder Mixes Two Concerns]]

## Related

[[Architecture]] · [[Backend]] · [[Components]] · [[Technology Stack]] · [[Codebase Map]] · [[Mobile Architecture]]
