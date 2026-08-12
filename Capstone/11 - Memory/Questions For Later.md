---
type: memory
title: Questions For Later
tags: [memory, questions, backlog]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Questions For Later

Not blocking anything. Worth thinking about when you have slack — these are the questions whose answers would change how the *next* version is built.

## Design questions

- **Should the three state machines be unified?** Three designs (adjacency+BFS, rank, rank+terminal set) is defensible — each fits a different shape of rule. But it's three things to learn. → [[State Machines]]
- **Should notifications move out of triggers into an outbox?** Same mechanism would also fix [[integration_log]] reconciliation and give you push notifications. One pattern, three problems. → [[ADR-005 Notifications In Database Triggers]]
- **Should AI narration return JSON instead of prose?** The prompt currently asks for periods-as-delimiters — a structural contract expressed in prose, the only unforced fragility in an otherwise strict design. → [[Deterministic Core With Nullable Narration]]
- **Is application-layer RBAC still the right call at 10× the scale?** It's right today; per-user connections + live RLS is the alternative, and the 71 policies are already written. → [[Why RLS Is Not A Boundary]]
- **Should UVVRP be `block` or `warn`?** Currently `block`. Blocking is safer and removes dispatcher judgement on exception days. → [[UVVRP Number Coding]]

## Scaling questions

- **What breaks first at 200 vehicles instead of 20?** Candidates: the advisory-lock contention on dispatch creation, the trigger-per-notification write amplification, `ailogs` growth (731 rows on 2026-08-11 and unbounded).
- **Does the AI advisory's scoring hold up with more candidates?** It's O(n) arithmetic over candidates — fine — but the *ranking* was tuned against a 20-vehicle fleet.
- **Does `mobile_refresh_tokens` need partitioning, or just a cleanup job?** Almost certainly just a cleanup job. → [[mobile_refresh_tokens]]

## Product questions

- **Is foreground-only GPS acceptable to real drivers?** A driver who backgrounds the app stops reporting. Background needs a dev build plus store review. → [[ADR-010 Foreground Only GPS]]
- **What happens when Booking and Fleet disagree about a reservation's state?** No reconciliation job exists. → [[System Boundaries]]
- **Should drivers be able to decline a trip?** [[Trip State Machine]] has no backwards path after `DRIVER_ACCEPTED`.

## Questions about this vault

- **Is `last_verified` actually being maintained?** If it drifts, the vault becomes exactly what it documents. → [[Documentation Rot]]
- **Which notes get used?** After a month, the ones you never opened should be deleted, not "improved". → [[Weekly Review Workflow]]

## The difference from [[Open Questions]]

[[Open Questions]] blocks work — an unanswered design question there stalls a fix. This list doesn't block anything. Don't let it feel like a backlog.

## Related

[[Open Questions]] · [[Things I Still Don't Understand]] · [[Roadmap]] · [[Decision Log]]
