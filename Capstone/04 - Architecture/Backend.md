---
type: architecture
title: Backend
tags: [architecture, backend, api]
source:
  - src/app/api
  - src/lib/api/utils.js
  - src/services
  - src/lib/db.js
last_verified: 2026-08-11
---

# Backend

**113 API route handlers** under `src/app/api/**/route.js`. No central middleware — each handler authorizes itself.

## Route groups — CONFIRMED (by file count)

| Group | Routes | Purpose |
|---|---|---|
| `integration/` | 15 | Booking/PMS boundary → [[System Boundaries]] |
| `mobile/` | 11 | Driver app endpoints → [[Mobile Architecture]] |
| `ai/` | 11 | Advisory + logs → [[AI Architecture]] |
| `trips/` | 8 | Execution → [[Trips]] |
| `reservations/` | 6 | Request lifecycle → [[Reservations]] |
| `reports/` | 6 | Analytics |
| `driver/` | 6 | Driver portal (web) |

## The handler shape — CONFIRMED

Every route follows the same four steps:

```js
export async function POST(req, { params }) {
  try {
    const identity = await requireAuth(req, ["dispatcher", "fleet_manager"]);  // 1. authorize
    const body = await parseBody(req, SomeSchema);                             // 2. validate
    const result = await someService.doThing(body, identity);                  // 3. delegate
    return ok(result);                                                          // 4. respond
  } catch (e) {
    return handleError(e);
  }
}
```

`ok()` / `err()` / `handleError()` from `src/lib/api/utils.js` keep response shapes uniform. `handleError` is what maps the trigger's `P0001` conflict into a user-facing message.

**The uniformity is the strength here** — you can read any of the 113 routes and know where to look.

## Data access — CONFIRMED

Two paths, both from `src/lib/db.js`, both privileged:

| Function | Use |
|---|---|
| `getAdminClient()` | Supabase JS client, service role |
| `query(sql, params)` | raw `pg`, one connection per call |
| `withTransaction(fn)` | raw `pg`, one **pinned** connection |

Use `withTransaction` whenever two statements must be atomic. The canonical case is [[driver_vehicle_assignments]] — see [[Connection Pooling vs Transactions]].

→ [[ADR-004 Dual Database Access]]

## Cross-cutting helpers worth knowing

| Helper | Location | Does |
|---|---|---|
| `writeAudit()` | audit lib | Appends to `audit_logs` (226 rows) |
| `assertTripOwnership()` | trips lib | 404-on-not-yours → [[Anti Enumeration 404 vs 403]] |
| `syncVehicleStatus` / `syncDriverStatus` | `src/services/status.service.js` (:11, :232) | Propagate status across the vocabularies → [[Data Flow]] |
| `advanceReservation()` | `reservation-lifecycle.service.js` | **The only** legal writer of request status → [[ADR-007 Single Writer For Reservation Status]] |
| `emitTransportStatus()` | integration | Outbound event + [[integration_log]] row |

## Known backend problems

- [[BUG AuthError Not Imported]] — undefined symbol on a 404 path
- [[DEBT Runtime DDL On Hot Path]] — `CREATE TABLE` inside handlers
- [[DEBT Services Folder Mixes Two Concerns]] — server and client modules share a folder
- No audit that every route actually calls `requireAuth` → [[Authentication]]

## Related

[[Architecture]] · [[Frontend]] · [[Authentication]] · [[Database Overview]] · [[Codebase Map]] · [[Data Flow]]
