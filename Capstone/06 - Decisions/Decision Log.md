---
type: moc
title: Decision Log
tags: [moc, decisions, adr]
source:
  - supabase/migrations
  - src/lib
last_verified: 2026-08-11
---

# Decision Log

	Architectural decisions **reconstructed from repository evidence**. Where the repo states a reason, it's quoted. Where it doesn't, the note says so — no reasoning is invented.

## The ADRs

| ADR | Decision | Evidence quality |
|---|---|---|
| [[ADR-001 Single Organization]] | No branch scoping | ✅ Stated in `contracts.js` + migration 013 |
| [[ADR-002 Anti-Corruption Layer]] | Translate at the Booking boundary | ✅ Extensively documented in code |
| [[ADR-003 Deterministic AI]] | AI advises, never decides | ✅ Explicit docstring |
| [[ADR-004 Dual Database Access]] | Supabase client **and** raw `pg` | ⚠ Partial — `withTransaction` explained, coexistence not |
| [[ADR-005 Notifications In Database Triggers]] | Notifications in plpgsql | ❌ **Undocumented** |
| [[ADR-006 Dual Double-Booking Guard]] | App check + DB trigger | ✅ Migration 023 explains itself |
| [[ADR-007 Single Writer For Reservation Status]] | One function writes status | ⚠ Implied by structure, not stated |
| [[ADR-008 Manual Migration Procedure]] | Hand-written `pg` scripts | 🔄 **Superseded 2026-08-11** — replaced by `npm run db:up` + a `schema_migrations` ledger. The stated reason in `AGENTS.md` was **false**; the underlying reason was not, and still applies. |
| [[ADR-009 Separate Mobile Auth]] | Mobile JWT ≠ web session | ⚠ Mechanism documented, choice not |
| [[ADR-010 Foreground Only GPS]] | No background location | ✅ Stated in `tracking.js` — 🔄 **Superseded 2026-08-19** by [[ADR-011 Background GPS Tracking]] |
| [[ADR-011 Background GPS Tracking]] | Foreground + headless background task (AppState-driven) | ✅ Decision recorded 2026-08-19 |

## What the pattern shows — INFERRED

**Six of eleven decisions are well-evidenced; the rest are not.** And the well-evidenced ones are documented *in the code that implements them* — docstrings and migration headers — never in `docs/`.

The rule this suggests: **write the "why" where the "what" lives.** A reason recorded next to its implementation survives; a reason recorded in a separate file rots. → [[Documentation Rot]]

Phase 3 supplied a clean confirmation. Migration `036_drop_vehiclereservations.sql`
carries its reasoning in its header, so the deletion explains itself at the point
of the change. The four ERDs that described the same schema carried none, had
drifted, and were deleted rather than redrawn — `schema.sql` is regenerated from
live by `npm run db:dump`, so it cannot rot silently.

## Decisions I could not reconstruct

These are real choices with no recoverable reasoning. Recording them as open questions is more useful than guessing:

1. Why do `transportation_requests` and `vehiclereservations` both exist? — **still unreconstructed, and now unreconstructable from the schema:** the table was dropped in migration 036 on 2026-08-11 rather than explained. The repository does not document why the old one was kept for twenty-two migrations. → [[DEBT vehiclereservations vs transportation_requests]]
2. Why is RLS enabled at all if it's inert? → [[Why RLS Is Not A Boundary]]
3. Why are notifications database triggers? → [[ADR-005 Notifications In Database Triggers]]
4. ~~Why is `substitute_vehicle_schedules` in the schema with **1 row** and zero references?~~ — **ANSWERED 2026-08-19:** it is substitute-driver coverage (migration 040 + API + card shipped it); now managed by the `/fleet/assignments` module. → [[Assignments]]

→ [[Open Questions]]

## Related

[[Home]] · [[Architecture]] · [[Learning Dashboard]] · [[Open Questions]] · [[Technical Debt]]
