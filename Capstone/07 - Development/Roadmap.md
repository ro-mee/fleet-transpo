---
type: status
title: Roadmap
tags: [development, roadmap, planning]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Roadmap

Sequenced by **what unblocks the most**, not by what's most interesting.

## Phase 1 — make verification possible ✅ DONE 2026-08-11

1. ~~`npm i -D vitest@^3.2.7`, run the suite, **read the failures**~~ → **186 tests, 15 files, all passing** (now 191, after the state-machine tests added in Phase 2). There were no failures; there was a test asserting a bug. → [[DEBT Vitest Not Installed]]
2. ~~Fix [[BUG shouldGroundVehicle Is A Stub]] **and rewrite its test**~~ → both, in one change. The rule was documented in three places all along. → [[Tests Can Encode Bugs]]
3. ~~Fix [[BUG AuthError Not Imported]]~~ → and found **two more instances of the same bug class** (`Badge`, `Search` in `assign-dialog.jsx`) by grouping lint output by rule.
4. ~~Delete root `proxy.js`~~ → confirmed dead by reading `next/dist/build/index.js:617`, not by assuming. → [[BUG Root proxy.js Is Dead Code]]

**Exit criteria met:** `npm run test:run` passes, and what it covers is now documented — pure functions in `src/lib/` only, **no route-level tests**. → [[Testing]]

5. ~~Carried forward: enable `no-undef` for `.js`~~ → enabled, and it immediately
   found a **4th** instance of the same bug class (`setRequestFlags` in
   `reservations/queue/page.js`). Lint went 60 → 38 errors: 22
   `react/display-name` errors vanished because they were all inside
   `mobile/dist/**`, now excluded.

## Phase 2 — make the schema reproducible ✅ DONE 2026-08-11

6. ~~`scripts/dump-schema.mjs` → checked-in `schema.sql`~~ → 39 tables, 1 view,
   88 FKs, 95 indexes, 13 functions, 19 triggers. Emits **no timestamp**, so any
   diff is a real schema change.
7. ~~Backfill migrations for the undeclared tables~~ → migration **034** declares
   `ailogs`, `ai_report_narratives`, `system_settings`,
   `substitute_vehicle_schedules`; **035** adds the undeclared
   `driverincidents.assistance_needed` column.
   **This item was wrong on two counts.** `driver_stats` is a **view**, not an
   undeclared table. And `substitute_vehicle_schedules` holds **1 live row**, so
   it was declared rather than dropped — dropping destroys data, which is a
   product call. → [[Current State]]
8. ~~Remove the runtime `CREATE TABLE` calls~~ → gone from `src/lib/ai/logger.js`
   and both `api/ai/*` routes. The DDL had already **drifted** from the real
   table: it omitted `target_feature`. → [[DEBT Runtime DDL On Hot Path]]
9. ~~Close the `'Pending Reassignment'` gap~~ → migration **033** plus an explicit
   `INTERRUPT` set in `dispatch-state.js`. The monotonic `RANK` could not express
   it: entry is from `Scheduled` **or** `In Progress` and exit returns to
   `Scheduled` — a cycle. → [[BUG Pending Reassignment Not In State Machine]]
10. ~~`scripts/migrate.mjs` with a `schema_migrations` ledger~~ → keyed on
    **filename, not version**, because the numbers are not unique. Nine one-off
    root scripts deleted. → [[ADR-008 Manual Migration Procedure]]

**Exit criteria met**, with one caveat worth stating precisely: the schema is now
**recorded** in the repo (`schema.sql`) and drift is **visible** (any diff in that
file is a real schema change). Rebuilding a fresh database is `schema.sql` +
`migrate.mjs baseline` — **not** `db:up`, because the migration files still
cannot be replayed. That rebuild path has never been executed. See
[[Migrations]] and priority 2 in [[Current State]].

**Unplanned, found en route:** every verification script in the repo had been
loading **zero** credentials. → [[Verification Tooling Can Be Dead]]

## Phase 2.5 — do this before Phase 3 ✅ DONE 2026-08-11

~~**0. Rotate the database password.**~~ One of the nine deleted one-off scripts,
`run_sql.mjs`, hardcoded the live password and host. `git rm` removed the file
from the working tree; **the credential is still in git history** and must be
treated as compromised. Rotating it is the only fix — no amount of deleting
files achieves it. → [[SEC Database Password In Git History]]

**Done:** rotated in the Supabase dashboard; `.env` updated. The old password
is now rejected by the server and the new one runs the whole toolchain
(191 tests, `db:status`, `db:dump`, no schema drift). History still contains
the old value — now worthless — and `git filter-repo` remains optional
housekeeping for the day this repo is ever published.

## Phase 3 — close the comprehension gaps ✅ DONE 2026-08-11

Three commits: `5c12719`, `2e3f95a`, `a654018`. → [[2026-08-11 Phase 3 Deletion And Unification]]

11. ~~Drop `vehiclereservations` + the dead `reservation_id` sync branch~~ —
    migration 036. Reached further than the note implied: 2 columns, 2 FKs, 2
    indexes, 2 trigger functions, `syncDispatchReservation()` and its **5 call
    sites in 3 modules**, plus the `/api/reservations/*` tree.
    `dispatchschedules` now has one parent. → [[DEBT vehiclereservations vs transportation_requests]]
12. ~~Unify or deprecate the pull ingest path~~ — **unified.** Pull has a live
    caller (`src/services/transport.service.js:112`), so deprecating it was off
    the table. Both doors now call `ingestRequest()` in
    `src/lib/integration/ingest.js`; four differences kept deliberately (auth,
    error handling, `event_type`, audit shape). → [[DEBT Ingest Paths Diverge]]
13. ~~Rewrite `README.md`, `docs/rbac-model.md`, `SYSTEM.md`; delete the stale
    ERDs~~ — done, and **four** ERDs not two. `SYSTEM.md` was corrected in place
    rather than regenerated, to avoid discarding accurate detail or inventing
    replacements. The grounding gotchas at `:457-459` and `:587` are gone.

**Unplanned, found en route:** `npm run test:run` and eslint **both pass with a
deleted symbol still imported** — vitest only loads what its tests reach and the
eslint config doesn't resolve imports. Grep after every deletion.
→ [[Things I Should Not Forget]]

## Phase 4 — prove the system actually works (multi-day)

14. **Seed realistic data.** ~200 trips over 3 months, fuel records, attendance. Then re-check every report against hand-computed values → [[Reports]]
15. ~~Write the missing pages: `/fleet/availability`, `/drivers/availability`, `fleet/maintenance`~~ — written (Phase 4 item 15), then merged **2026-08-23** into `/dispatch/availability`. `/maintenance` lives at `/maintenance`. → [[Frontend]]
16. Exercise the 10 zero-row tables end to end → [[Feature Index]]
17. A **two-connection race test** against `trg_dispatch_overlap` — the guard has never actually been raced → [[ADR-006 Dual Double-Booking Guard]]

## Phase 5 — before anything goes live

18. Route-auth audit: assert every `src/app/api/**/route.js` calls `requireAuth`/`requireDriver` → [[Authentication]]
19. A reconciliation job over [[integration_log]] `WHERE status <> 'processed'`
20. Lock down CORS from wildcard → [[Technology Stack]]
21. Add the missing env keys: `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY` → [[Environment Setup]]
22. Decide on background GPS → [[ADR-010 Foreground Only GPS]]

## Deliberately not on this roadmap

- **Multi-tenancy** — explicitly rejected → [[ADR-001 Single Organization]]
- **Letting the AI write assignments** — the whole architecture rests on it not doing that → [[ADR-003 Deterministic AI]]
- **Rewriting the anti-corruption layer** — it's the best-designed part of the system

## Related

[[Current State]] · [[Technical Debt]] · [[Bugs]] · [[Open Questions]] · [[Home]]
