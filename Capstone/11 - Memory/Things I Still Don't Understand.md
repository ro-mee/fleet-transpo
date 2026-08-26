---
type: memory
title: Things I Still Don't Understand
tags: [memory, unknown]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Things I Still Don't Understand

Honest **UNKNOWN**s. Keeping this list is what stops an inference hardening into a fact.

## About the system's intent

- **What rank `'Pending Reassignment'` should have.** Not *whether* it's real — it is, in six files. The hard part is that it's a *regression* from a partly-assigned state back toward `Scheduled`, and the dispatch module assumes rank monotonicity. → [[BUG Pending Reassignment Not In State Machine]]
- **Why RLS is enabled if it's inert.** Defence in depth for a future move to per-user connections, a Supabase-Auth remnant, or documentation-as-SQL. → [[Why RLS Is Not A Boundary]]
- **Why notifications are database triggers.** Real trade-offs either way; no recorded reasoning. → [[ADR-005 Notifications In Database Triggers]]
- **Whether NULL arrival should mean "zero-length" or "occupies indefinitely".** The `COALESCE` in migration 023 chose the first. It's a real product question. → [[Half Open Intervals]]

## About the code

- **Whether every route calls a guard.** 113 routes. `scripts/verify-rbac.mjs` verifies the **role lists** on the routes it knows about (78 checks); nothing asserts a guard exists on all of them. → [[Authentication]]
- **Whether the GPS endpoint appends or overwrites.** If it overwrites, there's no track history and route replay is impossible. → [[Tracking]]
- **How the UI parses AI narration.** If it splits on `.`, an abbreviation breaks the bullets. → [[AI Advisory]]
- ~~**What `substitute_vehicle_schedules` is for.**~~ **Understood 2026-08-19:** substitute-driver coverage (migration 040 + API shipped). Managed via `/fleet/assignments`. → [[Assignments]]
- **Whether anything reads `notification_preferences`.** 0 rows. Possibly dead schema. → [[Notifications]]
- **What's in `workflow/Fleet Management System-2026-07-27-071922.pdf`.** Never opened. If it holds the original requirements, it's the missing "why" behind several of these.

## About the history

- **Why `vehiclereservations` was never dropped** after migration 016 moved everything to `transportation_requests`. Still unexplained — the repository does not document it. It is now unanswerable from the schema, because migration 036 dropped the table on 2026-08-11; only the twenty-two-migration gap remains as evidence. → [[DEBT vehiclereservations vs transportation_requests]]
- **How the duplicate migration numbers happened** — 019 exists three times. Merge artefacts, or deliberate?
- **Who applied the 5-value `chk_dispatch_status`** outside the migration files, and what problem it solved. → [[DEBT Schema Drift From Migrations]]

## The honest summary

The **mechanics** of this system are well understood now — every data path traced, every state machine read, every guard located. What's missing is **intent**: the original requirements aren't in the repository, so several decisions can be described precisely and explained not at all.

That gap is why the phrase *"the repository does not currently document why this decision was made"* appears throughout this vault instead of a plausible-sounding reason.

## Related

[[Open Questions]] · [[Questions For Later]] · [[Decision Log]] · [[Current State]] · [[Things I Learned]]
