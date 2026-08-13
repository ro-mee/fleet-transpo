---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, database]
source:
  - supabase/migrations/013
  - src/lib/integration/contracts.js
last_verified: 2026-08-11
---

# ADR-001: Single Organization

## Context

Fleet management products are usually multi-tenant or multi-branch — a `branch_id` on every table, scoping every query.

## Decision — CONFIRMED

**No branch scoping.** Migration `013` removed it, and `src/lib/integration/contracts.js` states the consequence at the boundary:

> *"Deliberately NO branch field (single-org Fleet; see migration 013)."*

The word **"deliberately"** is what makes this a decision rather than an omission. Both ERDs in `docs/erd/` still show a `branches` table — that's how you can tell it once existed. → [[DOC ERDs Missing Core Table]]

Corroborating evidence: `system_settings.hotel_location` holds **one** location, `"CoCo Star Hotel, Manila, Philippines"`. A multi-branch system couldn't store that as a singleton setting.

## Consequences

**Good:**
- Every query is simpler — no scoping predicate, no risk of a missing one leaking cross-tenant data
- No `branch_id` to thread through 113 routes
- `system_settings` can hold singletons like hotel location and the UVVRP policy → [[UVVRP Number Coding]]
- The boundary contract is smaller: Booking never sends a branch

**Costs:**
- Adding a second hotel is a schema-wide migration, not a configuration change
- Reporting can't segment by location

Given the scope (a capstone for one hotel), removing multi-tenancy is the right call — it eliminates an entire category of bug (the forgotten scoping predicate) that would never have earned its keep.

## Revisit if

The operation genuinely adds a second location. Note this would be a **large** change: 38 tables, 77 FKs, and every one of the 113 routes.

## Related

[[System Overview]] · [[ADR-002 Anti-Corruption Layer]] · [[Migrations]] · [[Decision Log]] · [[UVVRP Number Coding]]
