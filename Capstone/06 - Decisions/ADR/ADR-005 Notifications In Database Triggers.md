---
type: decision
status: accepted-undocumented
date: 2026-08-11
tags: [decision, adr, notifications, database]
source:
  - supabase/migrations (notification triggers)
last_verified: 2026-08-11
---

# ADR-005: Notifications In Database Triggers

## Context

The system must notify staff and drivers when a dispatch is created, a trip completes, a document is expiring, or maintenance is due.

The conventional place for this is the service layer: after a successful write, call a notification service.

## Decision — CONFIRMED as fact, UNDOCUMENTED as reasoning

Four **plpgsql triggers** create `notifications` rows:

| Trigger | Fires on |
|---|---|
| `trigger_notify_dispatch_created` | INSERT on [[dispatchschedules]] |
| `trigger_notify_trip_completed` | [[trips]] → Completed |
| `trigger_notify_document_expiry` | document expiry threshold |
| `trigger_notify_maintenance_due` | maintenance threshold |

**The repository does not currently document why this decision was made.**

## Reconstructing the trade-off — INFERRED

**The case for triggers:**
A notification cannot be missed. *Any* path that inserts a dispatch produces one — the API route, a migration, a manual `INSERT`, one of the ~10 root `apply*.js` scripts. Given that this codebase does have ad-hoc scripts writing directly to the DB (see [[DEBT Schema Drift From Migrations]]), that guarantee is worth something real. No caller can forget.

**The case against:**
- The logic is invisible from `src/`. Grep for "notification" and you find the read API; you'd conclude notifications are created there.
- It can't easily be unit-tested — you need a database.
- It can't call out to email or push. A trigger can't make an HTTP request.
- It's the same class of "logic lives in SQL" that makes [[ADR-006 Dual Double-Booking Guard]]'s trigger hard to discover — except there, the SQL is load-bearing for correctness, and here it's business workflow.

## Consequences

- 164 notification rows exist, so this **works** — one of the more genuinely exercised features
- Delivery is **in-app only**. No email, no push. A driver who doesn't open the app doesn't find out. → [[Notifications]]
- `notification_preferences` has **0 rows** — per-user settings were designed and never wired, and a trigger couldn't easily consult them anyway without more plpgsql
- Adding push notification requires either an outbox pattern (trigger writes a row, a worker sends) or moving the logic to the service layer

## Revisit if

- Push or email delivery is needed — the trigger approach doesn't extend there. An **outbox pattern** keeps the guarantee (trigger writes the row) while allowing delivery from application code.
- `notification_preferences` is ever implemented

## Related

[[Notifications]] · [[Database Overview]] · [[Decision Log]] · [[Open Questions]] · [[ADR-006 Dual Double-Booking Guard]]
