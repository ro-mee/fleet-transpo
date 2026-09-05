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

**Theme switching (standardized 2026-08-23, reworked 2026-09-05):** `use-theme.js` (`ThemeProvider`, `toggle`, `setMode`) flips the `.dark` class on `<html>`; all theme colors are CSS variables (`--bg`, `--sf`, `--fg`, …) consumed via Tailwind v4 `@theme inline`, and `color-scheme` is set per theme so scrollbars/form controls match.
- **View Transition path (supported browsers):** `document.startViewTransition()` + declarative CSS keyframes (`theme-reveal` / `theme-conceal` in `globals.css`) animating `clip-path: circle()` on the transition pseudo-layer (450ms, `cubic-bezier(0.22,1,0.36,1)`), expanding from the clicked toggle for light→dark and contracting back into it for dark→light. Origin/radius travel as `--theme-x/--theme-y/--theme-r`, set synchronously *before* `startViewTransition` with the initial clip in plain CSS — so the first paint is already a dot and the dark layer never flashes full-screen first. (An earlier WAAPI-after-`transition.ready` variant had exactly that pre-flash and was replaced.) Layering/`animation: none` resets live under `[data-theme-transition="expand"|"shrink"]`; cleanup is time-based (600ms) with a generation guard so a rapid re-toggle can't wipe the newer transition. (The old `@keyframes theme-expand/shrink` + `--theme-x/--theme-y`-only CSS approach is gone.)
- **Fallback fade (no View Transition API, hidden tab, or VT throw):** `commitWithFade()` adds `html.theme-fade` (~350ms of `background-color`/`border-color`/`color`/`fill`/`stroke` transitions, toggle button excluded, `box-shadow` excluded) so the page cross-fades instead of snapping. `prefers-reduced-motion` keeps the instant cut in every path.

## Empty and missing routes — CONFIRMED

| Path | State |
|---|---|
| `/maintenance` | Full CRUD register — was `/fleet/maintenance`, relocated by `9c69f08` (2026-07-30) |

The standalone `/fleet/availability` and `/drivers/availability` boards were slated for removal 2026-08-15 but that never landed — both pages stayed live until **2026-08-23**, when they were merged into the dispatch module as `/dispatch/availability` (one page, Drivers | Vehicles tabs, components `driver-availability-board.jsx` / `vehicle-availability-board.jsx`). Management gained Vehicles visibility in the merge; all three backing GETs (`/api/drivers`, `/api/vehicles`, `/api/driver-leave-requests`) already allowed management. The shared `StatusBoard` component was deleted with them.

The empty `src/app/(dashboard)/fleet/maintenance/` directory left behind by that
relocation was removed 2026-08-12.

## How the frontend talks to the backend

Through `src/services/*.service.js` **client fetch wrappers** — thin `apiFetch()` calls. But that same folder also holds server-side domain services, which is a real hazard: importing the wrong one into a client component pulls `@/lib/db` toward the browser. → [[DEBT Services Folder Mixes Two Concerns]]

## Related

[[Architecture]] · [[Backend]] · [[Components]] · [[Technology Stack]] · [[Codebase Map]] · [[Mobile Architecture]]
