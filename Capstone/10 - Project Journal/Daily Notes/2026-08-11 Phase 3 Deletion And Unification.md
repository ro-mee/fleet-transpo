---
type: journal
date: 2026-08-11
tags: [journal, daily]
source:
  - supabase/migrations/036_drop_vehiclereservations.sql
  - src/lib/integration/ingest.js
  - src/lib/integration/ingest.test.js
  - src/services/status.service.js
  - README.md
  - docs/rbac-model.md
  - SYSTEM.md
last_verified: 2026-08-11
---

# 2026-08-11 — Phase 3: Deletion and Unification

Continues [[2026-08-11 Phase 2 Schema Reproducibility]]. Three commits, one per
roadmap item: `5c12719` (item 11), `2e3f95a` (item 12), `a654018` (item 13).

The theme of this phase was **deleting things**, and the recurring surprise was
that everything I planned to delete was bigger than the note describing it.

## What I worked on

### Item 11 — drop `vehiclereservations` (`5c12719`)

Migration `036_drop_vehiclereservations.sql`, idempotent throughout. The removal
reached further than "one empty table": 2 columns, 2 FKs, 2 indexes, 2 orphaned
trigger functions, the `syncDispatchReservation()` function, its **5 call sites
across 3 modules**, and the `/api/reservations/*` route tree (6 routes that had
been answering 410).

`dispatchschedules` now has one parent, `request_id`. That was the schema's
biggest wart. → [[DEBT vehiclereservations vs transportation_requests]]

### Item 12 — unify the ingest paths (`2e3f95a`)

Decided **unify, not deprecate**, on evidence: `src/services/transport.service.js:112`
wires `/api/integration/pull` to a live UI button, so it isn't dead code.

Extracted `ingestRequest()` into `src/lib/integration/ingest.js`. Both doors now
run one sequence: contract parse → idempotency check → `estimateTrip()` →
`resolveVehicleCategory()` → the 19-column INSERT → `assignReservationNumber()`
→ `recordReservationEvent(CREATED)` → `integration_log`.

Four differences kept **on purpose**, because they belong to the door and not to
the row: auth (session vs service token), error handling (pull skips a bad item
and counts it; push answers 400), `event_type` (`_pulled` vs `_received`, so
reconciliation can still tell them apart), and audit shape (one row per operator
click vs one per request).

Six new tests, 191 → **197**. The load-bearing one asserts both routes emit an
**identical SQL string and identical params array** — which is exactly the
property that was broken. → [[DEBT Ingest Paths Diverge]]

### Item 13 — rewrite the docs (`a654018`)

`README.md` (was untouched `create-next-app` boilerplate with a mangled title),
`docs/rbac-model.md` (documented **9** roles; there are 6), and `SYSTEM.md`.
Deleted `docs/erd/` — **four** stale files, not the two the roadmap predicted,
all modelling the pre-013 multi-branch schema and none containing
`transportation_requests`.

## What I learned

- **The gates in this repo do not catch a broken import.** After item 11, both
  `npm run test:run` and eslint passed **while `syncDispatchReservation` was
  still imported in three modules with five call sites.** Vitest only loads what
  its tests reach; the flat eslint config doesn't run `import/no-unresolved`. A
  full-tree grep for a deleted symbol is not optional here — green is not a link
  check. I applied this preemptively in item 12 and it paid: I swept all five new
  imports rather than trusting the suite.

- **A cited path is a claim, and repetition is not corroboration.** Six vault
  notes cited `src/lib/scheduling/sync.js` — one in its `source:` frontmatter.
  **That file has never existed**, per `find` and `git log --all`. The code was
  in `src/services/status.service.js`. Six copies of one unchecked claim read
  exactly like six confirmations.

- **CONFIRMED has to mean "I read the file today".** [[DEBT Ingest Paths Diverge]]
  carried a table marked CONFIRMED in which two of six rows were false — it said
  the pull route had no auth and no idempotency check, when `requireAuth` was on
  line 18 and the dedupe `SELECT` was in the loop, *in the file the note listed as
  its source*. It also missed three real divergences. The actual bug was worse
  than the documented one, which is the good case; it could as easily have been
  the reverse.

- **Size a deletion by its references, not by the thing itself.** Every estimate
  I inherited this phase was low: one table became eleven objects, two ERDs became
  four, "the two stale claims in SYSTEM.md" became a dozen.

## Problems encountered

- **The obvious home for the shared ingest code was wrong.**
  `src/services/integration.service.js` looked right by name and is **client-side**
  (`apiFetch`). Server-side ingest went to `src/lib/integration/`, next to the
  three modules it actually needs. Caught before writing, by opening the file
  rather than trusting the name. → [[DEBT Services Folder Mixes Two Concerns]]

- **`SYSTEM.md` was corrected in place, not regenerated.** A wholesale rewrite of
  593 dense lines would have risked discarding accurate reference detail and
  inventing unverified replacements, which this project's own rules forbid. This
  is a narrower reading of "rewrite SYSTEM.md" than the roadmap line — flagged
  rather than decided silently.

- **Two mobile files showed as modified that I never touched**
  (`mobile/app/login.js`, `mobile/components/ui.js`). They were already dirty at
  session start. Left unstaged; every commit this phase staged named files only,
  because `Capstone/` is untracked and not gitignored.

- **`scripts/verify-rbac.mjs` appeared broken** when I ran it directly — it needs
  its loader: `node --import ./scripts/route-harness-loader.mjs`. Ran clean after
  that: **78 passed**, including the check that the UI matrix and per-route role
  lists agree. That harness is what makes the rewritten RBAC doc trustworthy
  rather than merely tidy.

## Decisions made

- **Unify rather than deprecate `/api/integration/pull`** — it has a live caller.
- **Keep `event_type` distinct between the two doors.** Reconciliation needs to
  distinguish a pulled request from a pushed one; that is signal, not divergence.
- **Delete the ERDs rather than redraw them.** `schema.sql` is generated from
  live by `npm run db:dump`, so it cannot rot silently. Four hand-drawn copies
  existed because each schema change produced a new diagram instead of a deleted
  one.
- **Attribute the Node version.** The README says 20.9+, which is **Next 16's**
  `engines` requirement — this repo declares none. Stating a bare number would
  have been a small new instance of exactly the rot being fixed.

## Gates at close

`npm run test:run` **197 passed / 16 files** · eslint clean on touched files (38
pre-existing UI errors unchanged) · `npm run db:status` **43 applied / 0 pending
/ 0 changed** · `npm run db:dump` produces **no `schema.sql` diff** · live totals
now 38 tables, 1 view, 77 FKs, 84 indexes, 11 functions, 16 triggers.

## Next steps

1. Add an `engines` field to `package.json` — small, and it makes the README's
   Node floor self-sourcing.
2. The 38 pre-existing UI lint errors; largest group is 15 `set-state-in-effect`.
3. Phase 4 (items 14–17), then Phase 5 (18–22). → [[Roadmap]]
4. Still open for a decision: migration renumbering (deferred in Phase 2), and
   whether `substitute_vehicle_schedules` (1 live row) stays.

## Related

[[2026-08-11 Phase 2 Schema Reproducibility]] · [[2026-08-11 Phase 1 Roadmap]] · [[Roadmap]] · [[Current State]] · [[Mistakes I Made]] · [[Things I Should Not Forget]] · [[Documentation Rot]]
