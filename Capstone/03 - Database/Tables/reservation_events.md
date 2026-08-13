---
type: reference
title: reservation_events
tags: [database, table, audit, reservations]
source:
  - src/lib/reservations/
last_verified: 2026-08-11
---

# Table: `reservation_events`

**69 rows** — CONFIRMED. An append-only record of every reservation status transition. The richest audit trail in the database, and the only one you can reason backwards from.

## Why it's trustworthy

Not because of discipline — because of **structure**. Reservation status has exactly one authoritative writer. There is no second code path that updates the column directly, so there is no way to change a reservation's state without producing an event. → [[ADR-007 Single Writer For Reservation Status]] · [[Reservation State Machine]]

Compare with `dispatchschedules` and `trips`, which have no equivalent trail.

## Reading it

Each row records a transition — from state, to state, when, and by whom. Because [[Reservation State Machine]] can walk multi-step paths via BFS, **one user action can produce several events**. That's not duplication; each intermediate state was genuinely entered.

69 events across 15 live requests is consistent with that: roughly 4–5 transitions per request. → [[transportation_requests]]

## What it's good for

| Question | How |
|---|---|
| How did this request reach its current state? | Filter by request, order by time |
| Which transitions actually occur in practice? | Group by from→to — the empirically used subset of the 9-state graph |
| Who approved this? | The actor column on the approving event |
| Are there impossible transitions? | Any from→to pair the machine says is illegal means a second writer exists |

That last one is the highest-value query in the vault: it's a **direct test of the single-writer claim**, answerable in one statement. → [[Testing]]

## Not the same as `audit_logs`

`audit_logs` (226 rows) is general-purpose. `reservation_events` is domain-specific and complete for its domain. Don't reconstruct reservation history from `audit_logs`.

## Related

[[Reservations]] · [[Reservation State Machine]] · [[transportation_requests]] · [[ADR-007 Single Writer For Reservation Status]] · [[Database Overview]] · [[ERD]]
