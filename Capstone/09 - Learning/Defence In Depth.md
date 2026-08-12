---
type: learning
tags: [learning, security, architecture]
source:
  - supabase/migrations/023_dispatch_overlap_guard.sql
  - src/lib/scheduling/conflicts.js
  - src/lib/api/utils.js
last_verified: 2026-08-11
---

# Concept: Defence In Depth

## What it is

More than one independent control on the same invariant, so that one failing doesn't mean the invariant fails.

The word doing the work is **independent**. Two checks that share a cause of failure are one check written twice.

## Why it matters

Every single control has a failure mode: a forgotten call, a race, a bad deploy. Layering only helps if the layers fail for *different reasons*.

## How it appears in my project

### Real depth — double-booking

| Layer | Where | Fails when |
|---|---|---|
| App pre-check | `src/lib/scheduling/conflicts.js` | concurrent requests (TOCTOU) |
| DB trigger | `trg_dispatch_overlap`, migration 023 | only if the trigger is dropped |

Genuinely independent: the app check is racy by construction, the trigger holds an advisory lock. The trigger is the guarantee; the app check is fast feedback. → [[ADR-006 Dual Double-Booking Guard]] · [[TOCTOU And Advisory Locks]]

### Real depth — mobile tokens

Short access-token lifetime, rotation, SHA-256 storage, **and** an audience split. Four controls, four different attacks. → [[Token Rotation And Refresh Races]]

### Not depth — RLS

32 tables, 71 policies, both DB paths connect privileged. RLS and app RBAC look like two layers; RLS contributes **zero**. → [[Why RLS Is Not A Boundary]]

This is the failure mode worth internalising: **a layer that isn't reachable isn't a layer.** It's decoration that makes the remaining single point of failure feel less lonely.

## The test for whether a layer is real

*Remove it and describe what breaks.*

- Drop `trg_dispatch_overlap` → concurrent double-bookings land. **Real.**
- Delete all 69 RLS policies → nothing changes. **Not a layer.**
- Remove `requireAuth` from one route → that route is public. **Real, and per-route** — which is why the route-auth audit matters. → [[Roadmap]]

If you can't state the failure, you haven't got a layer.

## The cost side

Depth isn't free — two implementations of one rule can disagree, and then the system looks nondeterministic (the UI says fine, the DB refuses). Mitigate by making the layers **asymmetric**: one authoritative, the other explicitly advisory, and say which is which. Migration 023 does exactly that.

## Common mistakes

| Mistake | Reality |
|---|---|
| Counting inert controls | See RLS |
| Two layers sharing a failure cause | One layer |
| Validating the same rule in UI and API only | Both are the app; a script skips both |
| No stated authority between layers | Divergence looks like a ghost bug |
| Depth as an excuse for a weak primary | Fix the primary |

## Related concepts

[[TOCTOU And Advisory Locks]] · [[Why RLS Is Not A Boundary]] · [[Fail Closed By Default]] · [[Token Rotation And Refresh Races]] · [[ADR-006 Dual Double-Booking Guard]] · [[Learning Dashboard]]
