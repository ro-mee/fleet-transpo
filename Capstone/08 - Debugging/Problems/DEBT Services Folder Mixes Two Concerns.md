---
type: debt
status: open
severity: sev-3
tags: [debt, services, architecture]
source:
  - src/services
  - src/services/fuel.service.js
last_verified: 2026-08-11
---

# Debt: Services Folder Mixes Two Concerns

## The problem — CONFIRMED

`src/services/` (30 files) contains **two unrelated kinds of module under one name**:

| Kind | Example | Shape |
|---|---|---|
| **Server domain service** | `reservation-lifecycle.service.js` | Real orchestration; DB writes; transactions |
| **Client fetch wrapper** | `fuel.service.js` (33 lines) | Thin `apiFetch()` calls, used from browser components |

Both are imported as `import { ... } from "@/services/fuel.service"`. Nothing in the naming tells you which kind you're getting.

## Why it's a problem

1. **Server-only imports can't be tested/bundled the way client code is** — pulling a service into a client component accidentally (e.g. one that calls `getAdminClient()`) drags service-role credentials toward the browser. That's the dangerous failure mode: an elevated-privilege import in client code.
2. **Reader cost.** "Does this function hit the DB directly or call an API?" is answered by reading the whole file, not the import.

## Evidence of the split

`fuel.service.js` — 33 lines of `apiFetch` → clearly client-side.
`reservation-lifecycle.service.js` — transactions + DB → clearly server-side.
Mixed together: `imports` inside `src/services/` that reach for both `@/lib/db` and `@/lib/api/fetch`.

## Fix — suggested

Split into `src/server/services/` (domain orchestration) and `src/services/` (client fetchers) — or, given this codebase's existing idioms, `src/lib/domain/` already exists for pure logic; put orchestration in `src/server/` and leave only fetchers in `src/services/`. Then grep for any client-side import of `@/lib/db` as a smoke test.

## Related

[[Architecture]] · [[Codebase Map]] · [[Backend]] · [[Technical Debt]] · [[Debugging Index]]
