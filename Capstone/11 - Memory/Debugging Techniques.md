---
type: memory
title: Debugging Techniques
tags: [memory, debugging, technique]
source:
  - (methods used to build this vault)
last_verified: 2026-08-11
---

# Debugging Techniques

Techniques that **worked on this specific codebase**, in the order they're worth reaching for.

## 1. Query `pg_constraint`, not the migration file

A migration records what someone intended when they wrote it. The live database records what is true.

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'dispatchschedules'::regclass;
```

This is what turned `'Pending Reassignment'` from a suspected code bug into confirmed schema drift. **The single most valuable habit in this repo.** → [[BUG Pending Reassignment Not In State Machine]]

## 2. Learn the real column names before writing a query

Two queries failed here on guessed names (`key`, `vehicle_type`). The fix:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'system_settings';
```

`system_settings` uses `setting_key` / `setting_value`. Thirty seconds up front beats three failed attempts.

## 3. Check row counts before believing any report

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```

`trips` = 2. Every trip-based metric is arithmetic over two rows. A report isn't wrong because the code is wrong — it's meaningless because the data isn't there. → [[Reports]]

## 4. When a code path seems never to run, check the join key

The reservation sync helpers keyed on `reservation_id`; live rows carry `request_id`. The branch was unreachable, and it failed **silently** — no error, just nothing. Look for a mismatch between what the query filters on and what the rows contain.

*(That specific instance was deleted in migration 036, along with the table it pointed at. The technique is what survives — a filter on a column that is always NULL produces no error and no rows, which reads exactly like "nothing to do.")* → [[DEBT vehiclereservations vs transportation_requests]]

## 5. Grep for the *old* convention after a framework upgrade

`middleware.js` → `proxy.js` in Next 16. The build passes either way; the old file is simply never loaded. Nothing warns you. → [[Framework Version Drift]]

## 6. Read the docstrings — they're the accurate documentation here

`src/lib/db.js:56-72`, migration 023's header, `dispatch-advisor.js:11-14`, `mobile/lib/api.js`. These explain *why*, and they were right every time they were checked. `docs/*.md` was not. → [[Documentation Rot]]

## 7. Read the test names, not just the assertions

`it("grounds Minor/Moderate non-breakdown incidents as well", …)` — the title describes an *outcome*, not a rule. That phrasing is the tell for a test written from the code. → [[Tests Can Encode Bugs]]

## 8. Trace a symptom through the pure layer first

Business rules live in `src/lib/<domain>/` with no I/O. Read those before the route handlers or the UI — they're the whole rule, in one file, no setup needed to reason about. → [[Pure Core Imperative Shell]]

## 9. For "the UI says X but the DB says Y", suspect two implementations of one rule

Conflict checking exists in both `conflicts.js` and `trg_dispatch_overlap`. If they diverge, behaviour looks nondeterministic. The database is authoritative. → [[ADR-006 Dual Double-Booking Guard]]

## 10. When something works but shouldn't, check whether it's degrading

Four components fall back silently: LLM → `null`, priority → `Medium`, OCR → `""`, Booking gateway → mock. **Nothing in the UI says a fallback fired.** "It works but the output is empty/odd" usually means a degraded path. → [[Graceful Degradation]]

## Environment constraints — CONFIRMED

`supabase` CLI, `psql`, and `docker` are all unavailable here. Database work goes through a Node script using `pg` in the repo directory. → [[Quick Reference]] · [[Environment Setup]]

## Related

[[Debugging Index]] · [[Bugs]] · [[Things I Learned]] · [[Quick Reference]] · [[Important Commands]]
