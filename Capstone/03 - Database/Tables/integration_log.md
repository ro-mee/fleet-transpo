---
type: table
title: integration_log
tags: [database, table, integration, audit]
source:
  - src/lib/integration/booking-gateway.js
  - src/lib/integration/status-map.js
last_verified: 2026-08-11
---

# Table: integration_log

**149 rows** — the busiest table on the boundary, and the reconciliation record of record for everything Fleet has told the Booking subsystem.

## Purpose

Every outbound status event is written here **before** the gateway call, then updated with the result:

```
INSERT status='pending'  →  call gateway  →  UPDATE status='processed' | 'failed'
```

This ordering matters. Writing the intent first means a crash mid-call leaves a `pending` row — visible evidence that something needs reconciliation. Writing after the call would lose that.

## Why 149 rows against 15 requests

Each request emits an event on **every** status transition (RECEIVED → ACCEPTED → SCHEDULED → IN_TRANSIT → COMPLETED). Plus retries and failures. So the log grows several-fold faster than the request table — expected, not a bug.

## The key property: failures don't roll back — CONFIRMED

`emitTransportStatus()` marks the row `failed` and returns. **The Fleet-side status transition still commits.**

This is a deliberate availability choice: the parent system being down must not prevent a dispatcher from approving a request. The cost is that Fleet and Booking can disagree, and this table is the only way to detect it.

→ [[ADR-002 Anti-Corruption Layer]] · [[System Boundaries]]

## Nothing is actually being sent today — CONFIRMED

`getBookingGateway()` returns a **mock** unless `BOOKING_GATEWAY=http`, and `HttpBookingGateway` throws `"not connected yet"`. `BOOKING_GATEWAY` is not in `.env`.

So all 149 rows are mock-gateway traffic. The audit machinery is real and working; the far end is not connected.

## What's missing — INFERRED

There is **no reconciliation job**. Nothing scans for `status='failed'` or long-stale `pending` rows and retries them. The data to do it is all here; the process isn't written.

**TODO:** a periodic retry/alert over `integration_log WHERE status <> 'processed'` is the obvious next step before this boundary goes live.

## Related

[[System Boundaries]] · [[Anti-Corruption Layer]] · [[transportation_requests]] · [[Database Overview]] · [[Reservations]]
