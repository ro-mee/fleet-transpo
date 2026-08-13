---
type: moc
title: System Overview
tags: [moc, system, architecture]
source:
  - docs/architecture/sub-system-integration.md
  - src/lib/integration/contracts.js
  - package.json
  - SYSTEM.md
last_verified: 2026-08-11
---

# System Overview

## What Fleet Transpo is — CONFIRMED

A **fleet & transportation management sub-system** for a single-organization hotel operation.

It is **not** a standalone ride-hailing app. It sits downstream of a parent **Booking/PMS subsystem**: Booking sends transportation requests; Fleet decides vehicle, driver, schedule, and execution, then reports status back.

**Evidence:**
- `docs/architecture/sub-system-integration.md` — the data-ownership matrix
- `src/lib/integration/contracts.js` — Zod schemas that *are* the boundary contract
- Live `system_settings.hotel_location` = `"CoCo Star Hotel, Manila, Philippines"`

**Context — CONFIRMED:** `package.json` names the project `capstone`. This is academic thesis work, which explains the demo-scale data and the test-harness pollution in `employees`.

## The problem it solves

A hotel receives guest transportation requests. Someone must decide *which vehicle*, *which driver*, *when*, without double-booking a resource, dispatching an expired-registration vehicle, or violating Manila's number-coding law. Fleet Transpo is that decision system, plus the execution tracking around it.

## Users — CONFIRMED (live `roles` table)

| Role | ID | Home | What they do |
|---|---|---|---|
| `system_admin` | 1 | `/dashboard` | Everything; short-circuits the permission matrix |
| `fleet_manager` | 2 | `/dashboard` | Vehicles, drivers, maintenance, documents |
| `dispatcher` | 3 | `/dashboard` | The queue: review, approve, assign, dispatch |
| `driver` | 4 | `/driver` | Own trips only; primary user of the mobile app |
| `management` | 7 | `/dashboard` | Read + analytics; explicitly denied lifecycle verbs |
| `admin` | 9 | `/dashboard` | Admin operations |

Six roles. See [[RBAC]] — and note [[DOC rbac-model Says 9 Roles]], because the "authoritative" doc disagrees.

## Major business processes — CONFIRMED

1. **Request intake** — pull or push from Booking → [[Reservations]]
2. **Triage** — priority derivation + conflict detection in the queue
3. **Approval** — review → approve/reject
4. **Assignment** — vehicle + driver as a pair → [[Dispatch]]
5. **Execution** — trip start → GPS → complete → [[Trips]]
6. **Reporting back** — outbound status to Booking → [[System Boundaries]]

Cross-cutting: [[UVVRP Number Coding]], [[Fuel]], [[Maintenance]], [[Notifications]], [[AI Advisory]].

## Two clients — CONFIRMED

| Client | Stack | Auth | Users |
|---|---|---|---|
| Web dashboard | Next.js 16.2.11 App Router, React 19.2.4 | NextAuth v4 cookie/JWT | 5 staff roles |
| Mobile | Expo SDK ~54, expo-router ~6 | Separate bearer JWT | drivers only |

Two independent auth systems by design. See [[Authentication]].

## Scale — CONFIRMED (live query 2026-08-11, after Phase 3)

38 tables + 1 view · 77 FKs · 113 API routes · 61 pages · 30 service modules · 43 migrations · 16 test files.

**Demo-scale data:** 20 vehicles, 23 drivers, 15 requests, **2 trips, 2 dispatches**. Biggest table is `ailogs` (731 rows on 2026-08-11, and unbounded — it grows on every AI call). 29 of 47 employees are soft-deleted harness accounts.

INFERRED: the system is feature-complete in breadth but lightly exercised in depth. 10 tables have zero rows — was 11, and the eleventh was dropped rather than filled.

## The one thing to understand first

**Authorization is application-layer. RLS is inert.** Both database paths hold elevated privileges, so RLS policies never fire despite being enabled on 32 tables. Every security guarantee comes from `requireAuth()` in `src/lib/api/utils.js`.

Read [[Why RLS Is Not A Boundary]] before touching anything security-related.

## Related

[[Architecture]] · [[Technology Stack]] · [[System Boundaries]] · [[Data Flow]] · [[Feature Index]] · [[Home]]
