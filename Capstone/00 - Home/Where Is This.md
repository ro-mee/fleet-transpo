---
type: navigation
title: Where Is This
tags: [navigation, index]
source:
  - src/app
  - src/lib
  - src/services
last_verified: 2026-08-11
---

# Where Is This Implemented?

> Answer-first navigation. Each row is a trail: **feature → code → data**.

## Authentication

```
Login UI                src/app/(auth)/login/page.js
      ↓
NextAuth config         src/lib/auth.js          ← bcrypt + rate limit 5/min
      ↓
The gate                src/lib/api/utils.js     ← requireAuth() — ALL 113 routes
      ↓
Permission matrix       src/lib/auth/permissions.js
      ↓
Table                   employees.password_hash → roles
```

Notes: [[Authentication]] · [[RBAC]] · [[employees]]

**Not middleware.** `src/proxy.js` is CORS-only. See [[BUG Root proxy.js Is Dead Code]].

## Vehicle assignment (vehicle ↔ driver pairing)

```
UI                      src/app/(dashboard)/drivers/[id]/page.js
      ↓
API                     src/app/api/driver-assignments/**/route.js
      ↓
Service                 src/services/driver-assignment.service.js
      ↓
Atomicity               src/lib/db.js → withTransaction()
      ↓
Table                   driver_vehicle_assignments  (uq_dva_active_* partial unique)
      ↓
Migration               supabase/migrations/017_driver_vehicle_assignments.sql
```

Notes: [[Driver Management]] · [[driver_vehicle_assignments]] · [[ADR-004 Dual Database Access]]

## AI vehicle recommendation

```
UI                      src/app/(dashboard)/reservations/queue/page.js
      ↓
API                     src/app/api/ai/recommendations/route.js
      ↓
Composer                src/lib/ai/dispatch-advisor.js
      ↓
Scorers                 src/lib/ai/rule-engine.js
                        src/lib/ai/pair-scoring.js     ← scores vehicle+driver as ONE unit
      ↓
Optional narration      src/lib/ai/llm-adapter.js      ← never the decision
      ↓
Tables                  vehicles, drivers, driver_vehicle_assignments
                        recommendation_snapshots (0 rows)
```

Notes: [[AI Advisory]] · [[AI Architecture]] · [[ADR-003 Deterministic AI]]

## Reservation status change

```
Any status change       src/services/reservation-lifecycle.service.js
                          → advanceReservation()   ← THE SINGLE WRITER
      ↓
State machine           src/lib/scheduling/reservation-state.js  (adjacency + BFS)
      ↓
Timeline                reservation_events table
      ↓
Outbound                src/services/outbound.service.js → integration_log
```

Notes: [[Reservations]] · [[Request Lifecycle]] · [[ADR-007 Single Writer For Reservation Status]]

## Dispatch creation + conflict checking

```
UI                      src/app/(dashboard)/dispatch/page.js
      ↓
API                     src/app/api/dispatch/route.js   ← guard stack lives inline here
      ↓
Conflicts               src/lib/scheduling/conflicts.js  (10 types)
UVVRP                   src/lib/uvvrp/uvvrp.service.js → enforceCoding()
      ↓
DB race guard           supabase/migrations/023_dispatch_overlap_guard.sql
      ↓
Tables                  dispatchschedules → trips
```

Notes: [[Dispatch]] · [[dispatchschedules]] · [[ADR-006 Dual Double-Booking Guard]]

## Mobile driver session

```
Login screen            mobile/app/login.js
      ↓
Auth provider           mobile/lib/auth.js
      ↓
Fetch + refresh         mobile/lib/api.js       ← single-flight refresh
      ↓
API                     src/app/api/mobile/auth/login|refresh|logout/route.js
      ↓
Tokens                  src/lib/auth/mobile-token.js  (15min access / 30day refresh)
      ↓
Table                   mobile_refresh_tokens   (SHA-256 hashed, single-use)
```

Notes: [[Mobile Architecture]] · [[Token Rotation And Refresh Races]]

## Trip execution

```
Mobile / dashboard
      ↓
Start                   src/app/api/trips/[id]/start/route.js   ⚠ has a live bug
Status                  src/app/api/trips/[id]/status/route.js
Complete                src/app/api/trips/[id]/complete/route.js
      ↓
Service                 src/services/trip-lifecycle.service.js
State machine           src/lib/scheduling/trip-state.js  (rank monotonicity)
      ↓
Tables                  trips → gpstracking, fuelrecords, driverincidents
```

Notes: [[Trips]] · [[BUG AuthError Not Imported]]

## Booking subsystem integration

```
Inbound PULL            src/app/api/integration/pull/route.js
Inbound PUSH            src/app/api/integration/transport-requests/route.js
      ↓
Contract (Zod)          src/lib/integration/contracts.js       ← the boundary
Category resolve        src/lib/integration/category-resolver.js
      ↓
Table                   transportation_requests
      ↓
Outbound                src/services/outbound.service.js
Vocabulary collapse     src/lib/integration/status-map.js
      ↓
Audit                   integration_log
```

Notes: [[System Boundaries]] · [[Anti-Corruption Layer]] · [[integration_log]]

## Number coding (UVVRP)

```
Settings UI             src/app/(dashboard)/settings/number-coding/page.js
Board                   src/app/(dashboard)/uvvrp/page.js
      ↓
Pure policy             src/lib/uvvrp/policy.js
Service + enforcement   src/lib/uvvrp/uvvrp.service.js → enforceCoding()
      ↓
Storage                 system_settings.uvvrp_policy   (JSONB)
Tables                  uvvrp_exemptions, uvvrp_violations
```

Notes: [[UVVRP Number Coding]]

---

## Related

[[Home]] · [[Codebase Map]] · [[Important Files]] · [[Feature Index]]
