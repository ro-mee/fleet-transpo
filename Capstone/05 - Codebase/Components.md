---
type: reference
title: Components
tags: [codebase, frontend, components]
source:
  - src/components
  - src/hooks
  - mobile/components/ui.js
last_verified: 2026-08-11
---

# Components

## Web — CONFIRMED

`src/components/ui/` holds Radix UI primitives (17 packages) wrapped in the **shadcn/ui** pattern: the primitive provides behaviour and accessibility, the local wrapper provides Tailwind styling. The components are copied into the repo rather than installed, so they are yours to edit.

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
