---
type: reference
title: Services
tags: [codebase, services]
source:
  - src/services
last_verified: 2026-08-11
---

# Services

30 files in `src/services/`. **Two unrelated kinds of module share the folder and the `.service.js` suffix.**

## Telling them apart

| Signal | Server domain service | Client fetch wrapper |
|---|---|---|
| Imports | `@/lib/db`, `@/lib/scheduling/*` | `apiFetch` / `fetch` |
| Length | 100+ lines | ~30 lines |
| Does | Transactions, DB writes, business rules | HTTP calls to `/api/*` |
| Example | `reservation-lifecycle.service.js` | `fuel.service.js` |

**Check the import block before you read anything else.** That's the reliable tell.

→ [[DEBT Services Folder Mixes Two Concerns]]

## The one that matters most

`reservation-lifecycle.service.js` → `advanceReservation()`

The **only** function that should write `transportation_requests.status`. It validates the transition against the adjacency map, writes the row, appends a [[reservation_events]] entry, and emits an outbound status event. Bypassing it produces a status change with no audit trail and no outbound notification.

→ [[ADR-007 Single Writer For Reservation Status]]

## The layering rule

```
route handler  →  service (orchestration, I/O)  →  lib/<domain> (pure logic)
```

Services are the **imperative shell**; `src/lib/<domain>/` is the **pure core**. A service may import a domain module; a domain module must never import a service or `db.js`. That constraint is what keeps the core testable. → [[Pure Core Imperative Shell]]

## Related

[[Codebase Map]] · [[Backend]] · [[Important Files]] · [[Pure Core Imperative Shell]] · [[Reservations]]
