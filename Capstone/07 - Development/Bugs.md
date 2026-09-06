---
type: status
title: Bugs
tags: [development, bugs]
source:
  - (see individual notes)
last_verified: 2026-08-20
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

## Fixed — 2026-09-06

- **Platform activity panel permanently 500 (`automation_logs` does not exist).**
  `GET /api/system/activity` queried `automation_logs` twice, but migration 005 deliberately dropped that table (40→22-table cleanup) and nothing recreates or writes to it — every request died with `42P01`, so the System Admin dashboard's Platform activity panel never loaded while all other panels worked.
  Fix (no migration — the drop was intentional, the route was stale): route reads `integration_log` only (recent LIMIT 20; `automation_*` counters removed, frontend already defaults missing counters to 0), with a guard comment against re-adding automation reads without a recreating migration + writer; panel/empty-state copy in `role-dashboard.jsx` de-promised the automation feed.
  Verified: fixed SQL live (20 rows + full counters); e2e `GET /api/system/activity` with a minted system_admin session → HTTP 200; diag session deleted (0 leftover); eslint clean. No schema change → no `db:up`/`db:dump`.

- **Raw `<script>` in root layout + login hydration mismatch (two console errors).**
  `src/app/layout.js` rendered a raw `<script id="theme-init">` inside `<head>` → React 19 dev warning (*"Scripts inside React components are never executed when rendering on the client"*).
  `src/app/(auth)/login/page.js` read `?reason=expired` in a lazy `useState` initializer (`window` on the client, `undefined` on the server), so with that param the server rendered the email field where the client rendered the amber session-expired banner → positional hydration mismatch.
  Fixes: theme script now delivered via `<Script strategy="beforeInteractive">` **inside the root `<head>`** (same synchronous before-paint execution, no raw script in the React tree — the previously-unused `next/script` import is now used; note: as a direct child of `<html>` it broke React resource ordering, so `<head>` placement is required); the notice is now read via `useSyncExternalStore` (server snapshot `false` = SSR HTML, client snapshot reads the live URL — no effect, no extra render, no `set-state-in-effect` warning).
  Verified: eslint clean on both files; full `npm run lint` green (0 errors, 0 warnings repo-wide).

## Fixed — 2026-09-04

- **Fuel console TDZ crash (`activeTab` read before declaration).** The smart-default derivation was textually ordered after the query that consumed it — a certain `ReferenceError` on every render in a real browser (invisible to curl/SSR checks and to eslint; caught by auditing declaration order after spotting the pattern). Restructured to fetch-tab-first + deferred override steering, verified by line-order audit on both fuel and queue pages.
- **Prevention layers landed 2026-09-04:** `no-use-before-define` (variables-only; classes off for the throw-from-function pattern, mobile off for file-bottom `StyleSheet`) is now an eslint error — triage fixed 14 textual hits by pure declaration reordering across fuel, queue, both driver form pages, vehicles form, and one test file (all deferred-execution closures, none live crashes; verified each). Smart-tab decisions extracted to pure `src/lib/scheduling/smart-default-tab.js` with 9 unit tests. Blessed pattern recorded in [[Useful Code Patterns]]. Gate status identical to main (0 errors; same 5 pre-existing warnings in untouched files).

- **`/settings/users/new` 404 on a running dev server (stale route manifest).**
  The file `src/app/(dashboard)/settings/users/new/page.js` existed and was
  committed, and guards were clean (`NAV_ROLES` admits `admin`/`system_admin`,
  `useRequireRole` redirects rather than 404s, no `notFound()` in the tree) —
  but the live server's router resolved `["", "settings", "users", "new"]` to
  `/_not-found` (confirmed in the flight data). The server process predated
  nothing relevant; its in-memory manifest had simply desynced. **Fix:
  restart `npm run dev`** — fresh process serves both `/settings/users` and
  `/settings/users/new` at 200 with no compile errors. If a committed route
  404s in dev, restart before touching code.
- **Duplicate `onError` key + duplicate comment in `settings/users/page.js`.**
  `toggleMutation` declared `onError` twice (last-wins, so no behavior change)
  and the header comment repeated its last line. Removed the duplicates;
  eslint clean on both users pages.

## Fixed — 2026-08-20

A sev-1 sweep of the API module (`src/app/api/**/route.js`) closed four defect classes:

| Bug | Was | Verified by |
|---|---|---|
| **SQL injection via column names (9 routes)** | `Object.keys(body)` interpolated into `INSERT`/`UPDATE` column lists with no allowlist — crafted keys like `"trip_status = 'Completed' --"` executed | all 9 routes rewritten to iterate a fixed `*_WRITABLE` allowlist; `vehicle-maintenance` was the reference pattern |
| **Raw `api_key` leaked to clients** | `POST /api/ai/providers` and `PUT /api/ai/providers/[id]` returned `SELECT *` rows including the secret (GET already masked) | shared `maskProvider()` applied on POST/PUT return rows; GET refactored to reuse it |
| **Driver can self-approve fuel claims** | `status` was a writable column in `POST /api/fuel`, and the `driver` role is admitted — a claim could arrive already `Approved` | `status` removed from `WRITABLE_COLUMNS`; every create now forces `Pending` explicitly (the DB default is `'Completed'`, so it must be explicit) |
| **Mobile fuel resubmit 500s every time** | `PUT /api/mobile/fuel/[id]` used `$${idx-2}`/`$${idx-1}` in `WHERE` but `id`/`driverId` landed at `$N+3`/`$N+4` → `invalid input syntax for type integer: "Pending"` on every rejected-report resubmit | `WHERE` now uses `$${idx}`/`$${idx+1}` |

Routes fixed for the injection class: `trips` (POST + `[id]` PUT), `integration/logs` (POST),
`vehicle-documents/[id]` (PUT), `vehicles/[id]/documents` (POST), `routes` (POST + `[id]` PUT,
with `distance_km`/`estimated_duration_minutes` aliases mapped to the real
`estimated_distance`/`estimated_duration` columns), `vehicle-categories` (POST + `[id]` PUT).

Verified: eslint clean on all 13 touched files; **362/362 tests pass**.

## Fixed — 2026-08-20 (Security Tier 1)

The Tier 1 slice of the security gap analysis (S1–S3). The other findings (S4–S13) remain open → [[Security Audit]].

| Bug | Was | Verified by |
|---|---|---|
| **Anon-key privilege escalation on `employees`** (S1) | migration 009 granted `anon` `INSERT`/`SELECT`, and the default Supabase grant gave `anon` full table privileges (UPDATE/DELETE/…). Anyone with the public anon key could `INSERT` an account at `role_id = 1` (`system_admin`) or, with UPDATE, overwrite a known email's `password_hash` — **account takeover, live** | migration 060 (drop both policies + `REVOKE ALL`); live `pg_policies`/`role_table_grants` show no anon access |
| **Seeded admin credential** (S2) | migration 008 shipped the `admin123` bcrypt hash for `admin@fleetops.com`; the plaintext is public | migration 061 NULLs the known hash where it still matches; live admin password **rotated** to a fresh strong hash (cost 10); decision: keep the account, rotate the credential |
| **Mobile login unthrottled** (S3) | `POST /api/mobile/auth/login` ran bcrypt compares with no rate limit — the largest brute-force gap | per-IP + per-account 5/min throttle (mirrors web login), 429 + `Retry-After` |
| **Password recovery via anon key** | `auth.service.js` called Supabase `signUp`/`resetPassword`/`updatePassword` through the browser anon client; `resetPassword` emails the reset link to any email, enabling account-takeover-by-email | anon functions removed; server routes `POST /api/auth/forgot-password` (rate-limited, identical generic response) + `POST /api/auth/reset-password` (session-bound employee, wipes `mobile_refresh_tokens`); forgot-password + reset-password pages rewired |

Verified: eslint clean on 6 touched files; **362/362 tests pass**; live DB checks above.

Related pipeline fix: `db:up` was blocked by 26 pre-existing checksum-changed files. Root cause: **LF↔CRLF line-ending churn**, not SQL drift — 25/26 were proven to be the LF/CRLF form of identical content (the 26th replays as a no-op). Fixed in `scripts/migrate.mjs`: `sha()` now hashes LF-normalized content (EOL-immune, verified), and a `rebaseline` command (`npm run db:rebaseline`) records the deliberate re-record. Ledger clean: **63 applied, 0 changed, 0 pending**; `db:up` runs again. → [[Migrations]]

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
