---
type: status
title: Bugs
tags: [development, bugs]
source:
  - (see individual notes)
last_verified: 2026-08-17
---

# Bugs

Open, verified defects. Each links to a full note with root cause and fix.

## Open

### Severity 1 — active exposure

*None currently open.* The leaked database password was **rotated on
2026-08-11** and the old value is now rejected by the server →
[[SEC Database Password In Git History]]

### Severity 2 — correctness hazards

- ~~**Reservation Info AI recommendations can serve stale or expired pair data.**~~
  The assignment dialog's unsafe AI fallback was removed on 2026-08-17; the
  Reservation Info panel's eight gaps (snapshot revalidation, canonical shape,
  regeneration, narration-key alignment, conflict-shape normalization, snapshot
  consumption) were **all closed 2026-08-18**. → [[BUG AI Recommendation Can Serve Stale Pair]]
- ~~**Availability endpoints 500 → AI-Assign shows false "Fully booked".**~~
  `/api/vehicles/available` + `/api/drivers` threw `ReferenceError` when
  `pickup_at` was present but `return_at` absent (a self-shadowing `const returnAt =
  returnAt ? ...`), so the AI-Assign dialog loaded no availability data and showed
  "Fully booked / 0 / 0" despite eligible resources. **Closed 2026-08-18.** →
  [[BUG Availability Endpoints 500 False Fully Booked]]

### Not yet filed as individual notes

- **`npm run lint`: 38 errors, 33 warnings** — all pre-existing, all in UI code. Largest groups: `react-hooks/set-state-in-effect` (15), `react/no-unescaped-entities` (13), refs (9), immutability (1). None are correctness bugs of the kind fixed below, but `set-state-in-effect` and `exhaustive-deps` are the two that can cause real render loops and stale reads.
- The earlier count was **60 errors**, including 22 `react/display-name` and 17 `no-img-element`. Those were **all inside `mobile/dist/**`** — gitignored Expo build output that was being linted. Excluding it removed them; no UI code changed.
- ~~**`no-undef` is disabled** for plain `.js`~~ → **enabled 2026-08-11**, with browser/node/serviceworker globals plus Expo's `__DEV__`. It found a 4th instance of the bug class within minutes. → [[BUG AuthError Not Imported]]
- **No gate resolves imports.** After a symbol was deleted in Phase 3, `npm run test:run` **and** eslint both passed while three modules still imported it across five call sites. Vitest loads only what its tests reach; the flat eslint config doesn't run `import/no-unresolved`. This is a hole in the gates, not a bug in a file — worth filing as its own note if a CI job is ever set up. → [[Things I Should Not Forget]]
- **Reports compute over empty tables — CONFIRMED, and it is not a code bug.** `/api/reports/financial`, `/fuel-consumption` and `/fleet-cost` all read `fuelrecords`, which has **0 rows**. The code is honest about it: `financial/route.js:15` guards the division (`totalDist ? … : 0`) and `fuel-consumption/route.js:22-30` returns an explicit zeroed shape when there are no records. So the endpoints return real zeros, not fabricated figures. The hazard is one of *presentation*, not correctness — a dashboard of zeros looks like a working system with a quiet month. Phase 4 item 14 (seed realistic data) is the fix. → [[Reports]]
- **Checked and dismissed:** the `Math.random()` calls in `reservations/new/page.js:126-150` are a **labelled** demo-fill button (`handleRandomFill`, toast: *"Filled mock transport request data!"*). Recorded here so the next person doesn't re-flag it.

## Fixed — 2026-08-11

| Bug | Was | Verified by |
|---|---|---|
| [[BUG shouldGroundVehicle Is A Stub]] | **Any** incident grounded **any** vehicle — and tore down its live dispatch | 8 tests in file; 197 suite-wide |
| [[BUG AuthError Not Imported]] | Trip-start with an unknown id threw `ReferenceError` → 500 instead of 404 | lint clean |
| `Badge` / `Search` unimported in `assign-dialog.jsx` | Assign dialog crashed on render whenever a required vehicle class existed, or >3 options | `react/jsx-no-undef` now clean |
| `setRequestFlags` unimported in `reservations/queue/page.js` | `flagsMutation` would throw on call — found by the newly-enabled `no-undef` | `no-undef` clean |
| [[BUG Pending Reassignment Not In State Machine]] | A real, fully-implemented status the validator rejected and migrations never declared | 5 new tests; migration 033 |
| [[BUG Root proxy.js Is Dead Code]] | Dead file described a different auth model than the real one | deleted; `src/proxy.js` only |
| [[DEBT Vitest Not Installed]] | 15 test files could not execute | 197 tests across 16 files pass |
| [[DEBT vehiclereservations vs transportation_requests]] | An empty legacy table with a sync branch that could never fire | migration 036; `db:dump` shows no drift |
| [[DEBT Ingest Paths Diverge]] | The pull door wrote **13** columns where the push door wrote **19** — a pulled request arrived with no category, estimate, reservation number or timeline | 6 new tests, one asserting both doors emit an identical SQL string and params |

One caveat on `setRequestFlags`: the import was missing, but `flagsMutation`
(`src/app/(dashboard)/reservations/queue/page.js:185`) is **referenced nowhere
else**, so it never ran. The flags API route, the service function, and the
read-only VIP/Emergency badges all exist — the write path was simply never
wired to a control. Fixing the import does not make the feature reachable;
that is a separate, unfiled gap.

## What these had in common — CONFIRMED

**Four** of the bugs were the **same bug class**: an identifier used but never imported. One was in a cold path (`AuthError`, a 404 branch), two were in hot paths (`Badge`, `Search` — the dispatcher's assign dialog), and the fourth was in unreachable code. All four were statically detectable, and none were detected, because `no-undef` was off for `.js` and only the JSX variant of the rule was enabled.

The fourth was found **the same day the guard went in**, which is the strongest
available evidence that the guard was the actual missing piece rather than the
three bugs being a coincidence.

The grounding bug was different and worse: it ran constantly and produced a *plausible* outcome. A grounded vehicle looks like the system working. It also had a **test asserting it was correct**, so the suite defended it. → [[Tests Can Encode Bugs]]

**The general shape:** bugs survive where nothing is looking. Not where the code is hardest.

## Related

[[Debugging Index]] · [[Technical Debt]] · [[Current State]] · [[Roadmap]] · [[Testing]]
