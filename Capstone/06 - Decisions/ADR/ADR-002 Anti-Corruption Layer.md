---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, integration]
source:
  - src/lib/integration/contracts.js
  - src/lib/integration/status-map.js
  - src/lib/integration/category-resolver.js
last_verified: 2026-08-11
---

# ADR-002: Anti-Corruption Layer

## Context

Fleet receives requests from a Booking/PMS subsystem it does not control. Booking's vocabulary differs from Fleet's:

| Concept | Booking | Fleet |
|---|---|---|
| Priority | `"Normal"` | `"Medium"` |
| Status | 7 external values | 9 internal values |
| Vehicle type | free-text string | `vehiclecategories.id` |

Without a translation layer, Booking's vocabulary leaks into Fleet's schema and Fleet can't evolve its internals without breaking the contract.

## Decision — CONFIRMED, extensively documented

A DDD **anti-corruption layer** in `src/lib/integration/`:

| Module | Translates |
|---|---|
| `contracts.js` | Zod schemas define the boundary; `normalizePriority()` |
| `status-map.js` | 9 internal → 7 external, and inbound the other way |
| `category-resolver.js` | free-text vehicle type → category id |

The code explains its own reasoning at each point:

**On the contract being code:**
> *"The mock gateway produces data validated against these; the real HTTP gateway will validate against the same schemas — so mock and production are guaranteed structurally identical."*

**On priority translation:**
> *"anything unrecognized degrades to Medium rather than throwing, so a vocabulary drift on Booking's side can never block ingest."*

**On status collapse:**
> *"so we can evolve Fleet internals without breaking the Booking contract."*

**On vehicle type:**
> *"Booking does not know Fleet's category ids and must never send one, so the string is what crosses the boundary and Fleet resolves it to one of its own `vehiclecategories` at ingest. The raw string is then kept verbatim as the record of what was actually asked for, even when it resolves to nothing."*

**Also:** *"Deliberately NO branch field (single-org Fleet; see migration 013)."* → [[ADR-001 Single Organization]]

## The consistent principle: degrade, never reject

Every translation has a **fallback rather than a throw**:

| Input | Behaviour |
|---|---|
| Unknown priority | → `Medium` |
| Unknown outbound status | → `RECEIVED` |
| Unresolvable vehicle type | → NULL id, **raw string kept** |
| Gateway call fails | → `integration_log` marked failed, Fleet transition still commits |

**Availability is chosen over strictness, everywhere.** A misbehaving upstream can never block a guest's transportation request from entering the system. For a hotel operation, that is the right trade — a request with a degraded priority is far better than a request that was rejected.

## Consequences

**Good:**
- Fleet's internal vocabulary can change freely
- Upstream drift degrades gracefully instead of causing outages
- Mock and real gateway are structurally identical by construction
- Keeping the raw string alongside the resolved id preserves the original intent

**Costs:**
- Silent degradation is silent. A priority quietly becoming `Medium` is invisible unless someone reads [[integration_log]].
- Translation tables must be maintained as either side evolves
- Nothing is actually connected yet — `HttpBookingGateway` **throws** — so none of this has run against a real upstream

## Revisit if

- The real Booking system connects and drift becomes observable — then **add logging on every fallback path** so degradation is visible rather than silent
- Fleet gains multiple organizations, invalidating the no-branch-field decision

## Related

[[Anti-Corruption Layer]] · [[System Boundaries]] · [[Reservations]] · [[integration_log]] · [[Decision Log]] · [[Graceful Degradation]]
