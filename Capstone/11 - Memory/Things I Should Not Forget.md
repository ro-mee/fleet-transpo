---
type: memory
title: Things I Should Not Forget
tags: [memory, critical]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Things I Should Not Forget

If you read one note before touching this codebase after a break, read this one.

## The five that will cost you hours

### 1. RLS is on and does nothing
32 tables, 71 policies, **all inert**. Both DB paths connect privileged. The real boundary is `requireAuth()` in `src/lib/api/utils.js`, applied by hand in every route. → [[Why RLS Is Not A Boundary]]

### 2. The live database ≠ the migration files
`chk_dispatch_status` has 5 values; migration 012 says 4. Four tables have no migration at all. Duplicate migration numbers, 008 missing, 019 three times. **Query `pg_constraint`.** → [[DEBT Schema Drift From Migrations]]

### 3. `middleware.js` does not exist — Next 16 renamed it to `proxy.js`
`src/proxy.js` is live (594 B). The root `proxy.js` was dead code implementing an auth model this project doesn't use — **deleted 2026-08-11**. `SYSTEM.md` still says `middleware.js`. Next resolves the proxy from `path.join(appDir, '..')`, so with `src/app` it only ever scans `src/`. → [[Framework Version Drift]]

### 4. A green test suite is not evidence the code is right
The suite passed 185/185 **while a sev-1 bug was live**, because `grounding.test.js` asserted the bug was correct behaviour. Installing vitest didn't reveal a failure — it revealed that the tests were defending the defect. Now **197 passing**, with that test inverted. → [[Tests Can Encode Bugs]]

**The gates here also miss unresolved imports.** In Phase 3, `npm run test:run`
and eslint both passed while a deleted function was still imported in three
modules with five call sites — vitest only loads modules its tests reach, and the
flat eslint config doesn't run `import/no-unresolved`. **After deleting or moving
any exported symbol, grep the tree for its name.** Green is not a link check.

### 5. `transportation_requests` is the real table
It is now the **only** one: `vehiclereservations` (0 rows, dead since migration
016) was dropped in `036_drop_vehiclereservations.sql` on 2026-08-11, along with
both `reservation_id` columns and the sync branch keyed on them. The four stale
ERDs that omitted `transportation_requests` are deleted; `schema.sql` replaces
them. → [[DEBT vehiclereservations vs transportation_requests]]

## Silent behaviours

| Thing | Silent effect |
|---|---|
| `BOOKING_GATEWAY` unset | Outbound goes to a **mock**. Nothing reaches Booking. Looks fine. |
| No LLM key | AI narration is always `null`. Scores still work. |
| `shouldGroundVehicle()` | **Was:** grounded **every** vehicle after any incident. Fixed 2026-08-11 — now grounds only breakdown-type or Major/Critical. The old behaviour was the dangerous kind: plausible, wrong, invisible. |
| OCR timeout at 6s | Resolves `""` — a blank field, not an error |
| Unknown Booking priority | Becomes `Medium` |

**None of these produce an error.** → [[Graceful Degradation]]

## Rules for changing things

- **Reassigning a driver's vehicle must use `withTransaction`.** Two pooled calls trip the `uq_dva_active_*` partial unique indexes mid-flight. → [[Connection Pooling vs Transactions]]
- **Never write reservation status directly.** One writer, or [[reservation_events]] stops being trustworthy. → [[ADR-007 Single Writer For Reservation Status]]
- **The AI must never write an assignment.** A human calls the assign endpoint. The guarantee is structural — don't add a write path. → [[ADR-003 Deterministic AI]]
- **Fixing `shouldGroundVehicle` meant fixing its test too** — done 2026-08-11. The suite had been asserting the bug. → [[Tests Can Encode Bugs]]
- **`DEFAULT_ROLES` excludes `driver` on purpose.** Don't "fix" it. → [[Fail Closed By Default]]

## Facts worth memorising

- **6 roles**, ids 1, 2, 3, 4, 7, 9 — not 9. `docs/rbac-model.md` was rewritten to say so on 2026-08-11; `scripts/verify-rbac.mjs` pins it (78 checks, run it with `node --import ./scripts/route-harness-loader.mjs`)
- **`response: "block"`** — UVVRP refuses, it doesn't warn
- **`P0001`** — the overlap trigger's error code. Map it to **409**, not 500. → [[Error Handling Patterns]]
- **15 min / 30 days** — mobile access / refresh lifetimes
- Three state machines, three designs, deliberately → [[State Machines]]
- **A cited file path is a claim.** Six notes cited `src/lib/scheduling/sync.js`; it has never existed. Open it before you cite it. → [[Mistakes I Made]]

## This vault is not in git — deliberately

**Decided 2026-08-11.** `Capstone/` stays untracked; OneDrive is the backup. No version history, so there is no way to recover yesterday's copy of a note.

Two consequences:

- **Never run `git add -A` or `git add .`** in the repo root. `Capstone/` is untracked *and* not in `.gitignore`, so a blanket add would commit the whole vault in one go. Stage named files instead.
- A mangled note is gone unless OneDrive's own file history has it. Treat large rewrites of a note the way you'd treat an unversioned file.

## When in doubt

The **docstrings are right**. `docs/` was wrong — as of 2026-08-11 `README.md`,
`docs/rbac-model.md` and `SYSTEM.md` have been rewritten against the live system
and the stale ERDs deleted, so the gap is closed *for now*. That is a snapshot,
not a property: prefer the source. → [[Documentation Rot]]

## Related

[[Current State]] · [[Quick Reference]] · [[Debugging Techniques]] · [[Technical Debt]] · [[Home]]
