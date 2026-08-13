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

## The import hazard

Client components import from `src/services/`, which also contains server-side modules that reach for `@/lib/db` and the **service role key**. Importing the wrong one into a client component pulls privileged code toward the browser. → [[DEBT Services Folder Mixes Two Concerns]]

**TODO:** grep client components for any transitive import of `@/lib/db` as a smoke test.

## Related

[[Frontend]] · [[Codebase Map]] · [[Technology Stack]] · [[Mobile Architecture]]
