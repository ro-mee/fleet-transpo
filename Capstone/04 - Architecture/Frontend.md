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

Auth surfaces (`(auth)/`) render without the dashboard chrome (the `DashboardLayout` short-circuits for those routes) and carry a premium editorial-split presentation: a branded left panel with animated route-line artwork plus a double-bezel form card. Motion respects `prefers-reduced-motion` via `MotionConfig reducedMotion="user"`; entrance states are rendered identically on server and client so hydration is safe.

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
