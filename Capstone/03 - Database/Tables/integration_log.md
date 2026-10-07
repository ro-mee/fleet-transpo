---
type: table
title: integration_log
tags: [database, table, integration, audit]
source:
  - src/lib/integration/booking-gateway.js
  - src/lib/integration/status-map.js
last_verified: 2026-10-07
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

## Current retry implementation — checked 2026-10-07

`reconcileFailedDeliveries` scans outbound `pending`/`failed` rows in log-ID order. The existing protected `/api/cron/reconcile` and super-admin health retry endpoint call it; this session did not activate or verify an external scheduler. Retry uses each row's source-specific PMS/POS gateway, not one gateway for the entire batch. A payload/row source conflict or missing identity remains failed. The documented historical `fleet` + absent/PMS payload source is treated as PMS.

The stored event is retried with its original ID/status/time. Only `delivered === true` marks it processed; false or missing delivery ACKs remain failed. Emission stops before gateway invocation if the log insert fails or returns no ID. This preserves the log-before-send ordering, but the original Fleet transition and log insert are still separate operations: a log outage requires staff follow-up and is not a durable automatic outbox. No new schema, per-request outbound sequence, inbound event ledger, atomic transition/outbox, concurrency claim or real partner ACK proof is established. HTTP gateways remain unconnected; mock processed rows are local acceptance only. Focused integration/pull/transition checks passed 131 tests after observed RED regressions.

## Related

[[System Boundaries]] · [[Anti-Corruption Layer]] · [[transportation_requests]] · [[Database Overview]] · [[Reservations]]
