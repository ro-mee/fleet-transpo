---
type: status
title: Bugs
tags: [development, bugs]
source:
  - (see individual notes)
last_verified: 2026-09-21
---

# Bugs

Open, verified defects. Each links to a full note with root cause and fix.

## Open

### Severity 1 — active exposure

- ~~**SEC-DB-003 — tables readable with the public anon key.**~~ **CLOSED
  2026-09-18.** `app_errors` was remediated by migration `114`; its two siblings
  `ai_prompt_templates` (`106`) and `trip_monitor_alerts` (`109`) by migration
  `115`. All three now return an explicit `42501` to `npm run verify:anon`, and
  `npm run db:contract` reports 0 violations. The full chain — the rehearsal, the
  role-switch measurement, and why the revoke was load-bearing rather than
  decorative — is in the dated section below.
- ~~**SEC-DB-006 — `driver_stats` bypassed RLS entirely.**~~ **CLOSED
  2026-09-18 by migration `115`.** The view ran as its OWNER (no
  `security_invoker`) with `anon` holding `SELECT`, so it read straight through
  the RLS protecting `trips` and `drivers`. A direct role-switch measurement
  returned **40** driver performance rows; the earlier report of "1 live row"
  was the probe's `limit=1` floor, not a count. Found by `npm run db:contract` —
  the anon probe had never looked at a view, because it enumerated
  `CREATE TABLE` only.

The leaked database password was **rotated on
2026-08-11** and the old value is now rejected by the server →
[[SEC Database Password In Git History]]

### Severity 2 — correctness hazards

- ~~**The copilot had no deterministic scope boundary.**~~ **CLOSED
  2026-09-18.** `classifyCopilotScope()` in
  `src/lib/dispatch/copilot-intents.js` now routes courtesy, out-of-scope and
  in-scope messages before request/evidence/provider work. Contextual follow-ups
  require a recent in-scope FleetOps turn or active reservation/recommendation
  state; an unrelated turn resets that context. The route returns a private
  `scope-only` response for courtesy and unrelated requests, preserving the
  existing dispatcher options and selection because the response carries no
  operational replacement state. Scope remains routing only: availability,
  eligibility, ranking, evidence and mutations stay server-owned. The prompt
  rule remains as a defense-in-depth narration constraint.
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
- **First Map tooltip refused for being on screen — the safe-viewport margin —
  MEDIUM, FIXED IN SOURCE 2026-09-21; device acceptance has not run.** Reported
  four times against the intent-driven `map_intro` tour: a fresh install claims the
  milestone and still shows no spotlight. The three earlier rounds all fixed
  *trigger-side* concerns — tabPress ordering, the Home Welcome handoff, the
  GPS-spinner gate, overlay elevation — and each closed with a green suite while
  device behaviour did not change. Presentation depends solely on
  `activeTargetLayout !== null`, and every path to `null` was a silent
  `return null`, so "the trigger never fired" and "the target never measured" were
  indistinguishable from the device. A `__DEV__` diagnostic on that gate produced
  the line that settled it:
  `spotlight not presenting — target above the safe viewport`,
  `{ milestone: "map_intro", targetId: "map.standby_status", y: 16, height: 49.78,
  minSafeY: 79.11 }`. The target occupied `16 → 65.78` — entirely on screen, and
  the intended step-0 target — while the gate demanded its bottom edge clear
  `insets.top + 40`. That margin was wrong for a top-anchored target: the header
  declares `top: insets.top + 16`, so its settled box (`insets.top + 16 ..
  insets.top + 66`) clears the bar by 26px, and the refusal only happened because
  the target's own safe-area insets had not settled when it measured
  (`16 = 0 + 16`) while the provider's already had — one declaration producing two
  coordinate systems in the same frame. Rejection is now a whole-box test against
  the window edges (`y + height <= 0`, `y >= SCREEN_HEIGHT`), which is what the
  gate's own comment already claimed it did; the slack is gone and presentation no
  longer depends on inset-settling order. Verified sound rather than assumed: the
  trigger side (`mapIntroPendingRef` is set synchronously before `map_intro`'s
  storage read and re-checked after `triggerMilestone`'s own read, so whichever
  async claim resolves first the other defers) and the registration bookkeeping
  (`registerTarget` / `unregisterTarget` / `commitWinner` ignore a stale instance's
  measurements). A bounded measurement retry was added alongside the gate fix for
  the adjacent case — a target measuring before its layout settles — but it was
  **not** the cause: that was the first hypothesis and the device log disproved it.
  Two source-text assertions moved with the change (`lib/coach-marks.test.js:703`,
  `:772`).
- **Coach-mark spotlight drawn in the wrong coordinate space — HIGH, FIXED IN
  SOURCE 2026-09-21, device confirmation pending.** Follows directly from the
  entry above: once the gate stopped refusing an on-screen target the spotlight
  presented on every step, but landed off the element — uniformly, on all of
  them. A uniform offset is a coordinate-space mismatch, not a per-target
  calculation error, and the mismatch is structural. `CoachMarkTarget` registers
  bounds from `measureInWindow`, which reports WINDOW coordinates, while
  `CoachMarkOverlay` draws its four scrim rectangles and its cutout with
  `StyleSheet.absoluteFill` inside the *provider's* container
  (`CoachMarkProvider.jsx:713`). Those are the same space only while that
  container sits exactly at the window origin — and it need not: the container
  also holds `<ConnectivityBanner />` as a layout-participating sibling above the
  navigator (`app/(app)/_layout.js:78`), and any parent padding, inset or
  transform moves it. Fixed by measuring the overlay container's own window
  origin and subtracting it from the target bounds before geometry is computed
  (`CoachMarkOverlay.jsx`: `containerRef` / `containerOrigin`). Correct by
  construction, and a no-op at the window origin, so it cannot regress a case
  that already lines up. **A `__DEV__` line now prints the origin beside the
  bounds it was subtracted from**, deduped per geometry change: if that origin
  reads `(0,0)` on device then the subtraction is not the whole story and the
  registered bounds themselves are stale, which is the next place to look.
- **The coach-mark suite cannot observe any of this — OPEN, structural.** 55 of the
  60 cases in `mobile/lib/coach-marks.test.js` read the source with `readFileSync`
  and assert with `toContain`, and `mobile/` contains no `react-test-renderer`, no
  `@testing-library/react-native` and no `render()` at all — the only runner is
  `vitest` over `mobile/lib`. So "60/60 green" has never meant the tour appears, and
  a trigger-side fix and a presentation-side fix are indistinguishable to the gate.
  That is the mechanism by which four rounds of green suites reached a device with
  no behaviour change, and it is why the gate fix above still needs a device run
  before it counts as evidence. A genuinely runtime test here needs a renderer added
  as a devDependency; until then every claim about this feature is a claim about
  source text.
  `lib/map-intro.test.js` (5 cases) exercises the stage machine's pure logic and is
  not implicated.
- **`mapIntroAwaitingTap` is unreachable — LOW, OPEN.** It is only ever set `true`
  inside `abandonActiveMilestone` when the active milestone is `map_intro`
  (provider `:297`), but both call sites are mutually exclusive with that branch:
  `:422` runs only when the active key is `"welcome"`, and `:610` is guarded by
  `activeKeyRef.current !== "map_intro"`. The flag is therefore permanently `false`
  and everything reading it (`:332`, `:374`, `map.js:613`) is inert — the "an
  abandoned tour is reclaimed" safety valve does not exist. Not the cause of the
  missing spotlight; recorded so it is not mistaken for a working guard.

### Not yet filed as individual notes

- **Mobile live-trip coach mark can disappear before telemetry (2026-09-20):** A fresh driver install correctly shows `welcome` on Home, but `map.js` can trigger `live_trip` while the first trip is `Driver Accepted` and still before `earliest_start`. In that state `preDeparture` renders an empty `map.telemetry` target, so `CoachMarkTarget` rejects its zero height and the overlay disappears after the first `Next`. The focused coach-mark suite is green (44/44); this scheduling-state case is not covered. No fix applied during the check.
- **Read-only Jack session inventory (2026-09-19):** The active-session query
  found **29 mobile refresh families and 0 web sessions**. Those families came
  from **310 token rows** total: 281 revoked rotation rows and exactly one
  active row per family, so token rotation is not creating duplicate session
  cards. Only 1 family was active in the preceding 24 hours, 4 in the
  preceding 7 days, and 24 were older than 7 days while still inside the
  30-day refresh lifetime. Repeated network addresses occur across families;
  no revocation or other live-data mutation was performed. This is a stale
  session-retention follow-up, not evidence that IP is a safe deduplication key.
- **`npm run lint`: 38 errors, 33 warnings** — all pre-existing, all in UI code. Largest groups: `react-hooks/set-state-in-effect` (15), `react/no-unescaped-entities` (13), refs (9), immutability (1). None are correctness bugs of the kind fixed below, but `set-state-in-effect` and `exhaustive-deps` are the two that can cause real render loops and stale reads.
- The earlier count was **60 errors**, including 22 `react/display-name` and 17 `no-img-element`. Those were **all inside `mobile/dist/**`** — gitignored Expo build output that was being linted. Excluding it removed them; no UI code changed.
- ~~**`no-undef` is disabled** for plain `.js`~~ → **enabled 2026-08-11**, with browser/node/serviceworker globals plus Expo's `__DEV__`. It found a 4th instance of the bug class within minutes. → [[BUG AuthError Not Imported]]
- **No gate resolves imports.** After a symbol was deleted in Phase 3, `npm run test:run` **and** eslint both passed while three modules still imported it across five call sites. Vitest loads only what its tests reach; the flat eslint config doesn't run `import/no-unresolved`. This is a hole in the gates, not a bug in a file — worth filing as its own note if a CI job is ever set up. → [[Things I Should Not Forget]]
- **Reports compute over empty tables — CONFIRMED, and it is not a code bug.** `/api/reports/financial`, `/fuel-consumption` and `/fleet-cost` all read `fuelrecords`, which has **0 rows**. The code is honest about it: `financial/route.js:15` guards the division (`totalDist ? … : 0`) and `fuel-consumption/route.js:22-30` returns an explicit zeroed shape when there are no records. So the endpoints return real zeros, not fabricated figures. The hazard is one of *presentation*, not correctness — a dashboard of zeros looks like a working system with a quiet month. Phase 4 item 14 (seed realistic data) is the fix. → [[Reports]]
- **Checked and dismissed:** the `Math.random()` calls in `reservations/new/page.js:126-150` are a **labelled** demo-fill button (`handleRandomFill`, toast: *"Filled mock transport request data!"*). Recorded here so the next person doesn't re-flag it.

## 2026-09-18 — SEC-DB-003 / SEC-DB-004 (found by live probe, not by the suite)

Two findings from the deployment-verification pass. Both are in the
database/RLS category. SEC-DB-003 was found by **reading migrations**, then
**confirmed by measurement**; SEC-DB-004 was found by reading and then
confirmed by observation. Neither is part of the 2026-09-17 security
assessment — they carry their own IDs and their own register.

### SEC-DB-003 — the anon key read `app_errors` — HIGH, PARTIALLY REMEDIATED

**Mechanism.** `app_errors` was created by migration `103`, whose header
states: *"No RLS changes either (RLS is inert by design; the read API enforces
audit-read permission)."* That premise was **already false when 103 was
written**. Migration `100`, three files earlier, had made RLS the mechanism
that actually stops PostgREST — it enabled RLS on 20 tables and explained in
its own comment that the app server connects as `postgres` via
`DATABASE_URL` and therefore bypasses RLS. `103` reasoned from the pre-100
world. `106` (`ai_prompt_templates`) and `109` (`trip_monitor_alerts`) then
inherited the omission without restating it.

This is a **stale premise propagated forward**, not a missing step anyone
forgot. Three sections of the same repository disagreed about whether RLS was
load-bearing, and the disagreement was invisible because nothing read the live
state.

**Measured, 2026-09-18 — AUTOMATED VERIFIED.** `npm run verify:anon` (new;
`scripts/verify-anon-access.mjs`) probes `GET /rest/v1/<table>?select=*&limit=1`
with **only** the public anon key — the value that ships in the browser bundle
by design. Before remediation:

```
EXPOSED   app_errors   1 row(s) readable
          columns: error_id, source, route, message, stack,
                   status_code, employee_id, fingerprint, user_agent, created_at
```

The returned row carried a populated `stack` — a full server stack trace with
internal paths, line numbers and SQL detail — plus `route` naming an internal
API endpoint, `employee_id` and `user_agent`. **Row count was not enumerated
past the probe's `limit=1`**; the true count was never measured. No values were
copied out of the database into this note.

**Why the read is trustworthy rather than an artifact.** The probe asserts
three controls every run, all of which passed: a **tampered key** is rejected
with `"Invalid API key"`; a **nonexistent table** returns `PGRST205`; the
**real key authenticates** (it was `42501`-refused on `employees`, a different
and correct outcome — no grant at all). Credential validity is judged by
*response message text*, not status code, because a wrong key and a valid-but-
denied key are both `401` — conflating those is how a broken run gets reported
as clean.

**Fix.** Migration `115_app_errors_rls.sql` — `ALTER TABLE public.app_errors
ENABLE ROW LEVEL SECURITY`, idempotent, no policies. Deny-all applies to roles
**subject** to RLS (PostgREST `anon` / `authenticated`); the table owner is not
subject to it, and the app connects as the owner. So the write path
(`src/lib/app-errors.js`) and the audit-read API (`/api/errors`) are unaffected
— the same mechanism migration `100` used on 20 tables. Deliberately **not**
`FORCE ROW LEVEL SECURITY`, which would subject the owner to deny-all and break
the application.

**Verified — fail-before / pass-after on the same probe.** The identical
command, unchanged, flipped `app_errors` from `EXPOSED` (1 row readable) to
returning no rows. Exactly one change was made between the two runs. The
honest limit of this evidence: the post-fix reading is `200 []`, which by the
probe's own rule is **INCONCLUSIVE** — it cannot distinguish deny-all from an
empty table. DB-side confirmation that RLS is actually enabled is what closes
that gap, and it is supplied by the database contract work, not by this probe.
Recorded as **partially remediated, pending contract confirmation**, not as
closed.

**STILL OPEN.** `ai_prompt_templates` and `trip_monitor_alerts` have the same
gap and were **not** part of the approved remediation. Both return `200 []`,
which proves only that **anon holds `SELECT`** on them (a role without the
grant gets `42501`) — it does not prove the rows are protected. They are
**unproven, not safe**, and are one `INSERT` from being the same finding.

**Also worth noting from the same probe run:** 50 of 58 tables returned
`200 []` and are therefore INCONCLUSIVE, not safe. Seven — `device_tokens`,
`driver_consents`, `driverattendance`, `employees`, `notification_preferences`,
`notifications`, `trips` — were `42501`-refused, which is genuine proof of
protection. Twenty of the 50 were explicitly covered by migration `100`, which
makes them *probably* deny-all, but "probably" is exactly what the contract
exists to replace.

### SEC-DB-004 — `schema.sql` is blind to RLS and grants — MEDIUM, OPEN

`scripts/dump-schema.mjs:11` states it: *"This is a structural dump, not
pg_dump: no data, no ownership, **no grants**."* It never queries
`pg_class.relrowsecurity` or `information_schema.role_table_grants`.

**Confirmed by observation, 2026-09-18.** Migration `114` enabled RLS on
`app_errors` and was applied successfully — and `npm run db:dump` produced
**zero diff** for it. Measured directly: `schema.sql` contains **0**
`ROW LEVEL SECURITY` statements and **0** `GRANT` statements, before and after.

So the file that is committed and diffed in every PR — described in
[[Migrations]] as *"the review artifact… what makes drift visible"* — **cannot
show a table losing RLS or gaining a public grant**. This is the same gap
`Migrations.md` names under *"What `024` teaches"*, and it is why SEC-DB-003
survived three migrations unnoticed: the artifact a reviewer reads is
structurally incapable of displaying the thing that went wrong.

The same dump does show migration `113`'s changes (`repair_completed_by`, the
`inspection_required` default flip), because those are structural. The dump is
not broken; it is scoped to structure, and RLS is not structure to it.

**Fix — not yet applied.** Emit RLS state and effective grants from
`dump-schema.mjs`, and gate them in the database contract (`npm run
db:contract`) so a table losing RLS fails a check rather than waiting to be
noticed.

## 2026-09-18 (later) — the database contract resolved the open tables, and found a view nobody had looked at

`npm run db:contract` ran for the first time. It reads the live catalog
(`pg_class.relrowsecurity`, `information_schema`-equivalent privilege checks,
`pg_policies`) rather than the REST surface, so it can settle what
`verify:anon` explicitly could not.

**Result on the 51 INCONCLUSIVE tables — and it is not what the probe implied.**

| Relations in `public` | Count | Verdict |
|---|---|---|
| RLS enabled, no anon policy | **56** | **PROTECTED** — proven regardless of row count |
| RLS disabled | **2** | **READABLE** — see SEC-DB-003 below |
| View running as owner with anon SELECT | **1** | **EXPOSED** — see SEC-DB-006 below |

So the 51 `200 []` results were **49 protected tables plus 2 readable ones**. The
probe was right to refuse to call any of them safe: two of them were empty, not
protected, and the distinction was invisible from outside.

### SEC-DB-003 — CONFIRMED READABLE (was "unproven") — HIGH, OPEN

`ai_prompt_templates` (`106`) and `trip_monitor_alerts` (`109`) both read back
**RLS disabled with `anon` holding `SELECT`, `INSERT`, `UPDATE` and `DELETE`**.
The probe's `200 []` was an empty table, not a policy denial.

The evidence chain is complete without touching a row: `200` (not `42501`)
proves `anon` holds the grant, and RLS-disabled proves no row filter exists — so
any row that is or becomes present is returned. **An empty table that `anon` may
read is not safe; it is one `INSERT` away from being exposed.** This is exactly
the trap the verdict rule was written to avoid, and it resolved against us.

`app_errors` is confirmed PROTECTED from the database side (RLS on, no anon
policy) — migration `114` verified twice over, by probe and by catalog.

**Remediation NOT applied.** The standing instruction is to report a new
exposure before remediating it.

### SEC-DB-006 — `driver_stats` is a complete RLS bypass — HIGH, OPEN

**New finding, found by this contract, confirmed by measurement.**

`driver_stats` is a view. A view carries no RLS of its own: unless it opts into
`security_invoker`, it executes as its **owner** — here `postgres`. So it reads
straight through the RLS that protects its base tables, and `anon` holds
`SELECT` on it.

```
npm run verify:anon --table=driver_stats
  EXPOSED  driver_stats  1 row(s) readable; columns: driver_id, total_trips,
                         total_distance, total_hours, rating, performance_score
```

No values were read out; the probe reports names only.

**Why nothing caught it.** `verify:anon` enumerated objects with
`/^CREATE TABLE/` against `schema.sql`. A view is not a `CREATE TABLE`, so
`driver_stats` was **never probed** — not on any previous run, and it is not in
migration `100`'s table list either. The table-level RLS that was added
everywhere else is real and correct; a view simply is not covered by it. The
probe now enumerates views too, which is why the EXPOSED count moved 0 → 1.

### SEC-DB-004 — the dump is still blind, and now it is gated instead

Unchanged as a defect (`schema.sql` still emits no RLS or grants), but the
consequence is contained: `npm run db:contract` fails when a `private` table
lacks RLS, gains an anon policy, or when a view exposes a bypass — so the class
of change that `schema.sql` cannot show now fails a check rather than a review.

### What now catches this class

- `src/security-assessment/schema-contract.security.test.js` — 12 offline gates
  on every `npm test`: every table and view in `schema.sql` must carry an access
  decision, every object the code queries must be declared, and no migration may
  drop or rename a declared object.
- `npm run db:contract` — the live half. Fails on an unclassified live table, a
  `private` table without RLS, an anon-permissive policy, a bypassing view, a
  contract entry with no live object, and code naming an object the schema lacks.
- `npm run verify:anon` — the end-to-end probe, now including views.

`gpstracking` is **no longer a flag**: the contract read RLS enabled with no anon
policy. It was never in migration `100`'s list, so this was genuinely unproven
until the catalog was read.

## Fixed — 2026-09-18 (SEC-DB-003 remainder and SEC-DB-006, migration `116`)

Migration `116_rls_gap_tables.sql` closes both. `ai_prompt_templates` and
`trip_monitor_alerts` get RLS; `driver_stats` gets `security_invoker = true`; and
all three have their `anon`/`authenticated` grants revoked.

**The revoke turned out to be load-bearing, not belt-and-braces.** Both tables
granted `anon` TRUNCATE, and **row security does not apply to TRUNCATE**. So
`ALTER TABLE … ENABLE ROW LEVEL SECURITY` alone would have stopped reads and
writes while leaving an anonymous caller able to empty the table. That was found
by reading the grant list before writing the REVOKE — it was not visible from the
RLS state, and it is the reason "enable RLS" is not by itself a complete answer
for a table that still holds grants.

**Rehearsed against live before applying.** Both the proposed DDL and the
application's real twelve read/write queries ran against production inside one
transaction that was then rolled back. Result: **12 of 12 queries identical**,
rollback verified (RLS flags, `reloptions` and every grant restored, zero stray
rows), and a role-switch probe inside that same transaction went from
`driver_stats: 40 rows visible` to `42501 permission denied` on all three.

**The first rehearsal harness proved nothing, and that is worth recording.** It
applied the DDL in one transaction, rolled that back, and then ran the
"rehearsal" suite in a *fresh* transaction without the changes — comparing
baseline to baseline. It printed a clean 12/12 and would have been reported as
evidence. The tell was a phase-order mistake visible only by reading the harness
back. A rehearsal that cannot fail is not a rehearsal.

**A correction to the earlier finding:** `driver_stats` exposed **40** rows, not
1. `verify:anon` uses `limit=1`, so "1 row readable" was a floor. The measured
count came from `SELECT count(*)` under a role switch.

**A correction to the counterintuitive part of the grant check:**
`information_schema.column_privileges` reported 20–48 column-level grants per
object, which looked like a second, separately-granted layer needing its own
REVOKEs. It is not: `pg_attribute.attacl` is NULL on every column, so those rows
are *derived* from the table-level grants. Measured by testing both variants —
table-level REVOKE alone denies everything. The migration therefore revokes at
table level only.

**Verified after applying:**

| Check | Result |
|---|---|
| `npm run verify:anon` | **EXPOSED 0** · PASS 10 (was 7) · INCONCLUSIVE 49 |
| the three objects | `ai_prompt_templates`, `trip_monitor_alerts`, `driver_stats` → **PASS, HTTP 401 (42501) — refused** |
| `npm run db:contract` | **0 violations**; 58 relations RLS-enabled with no anon policy; the view reads `security_invoker=on` |
| app queries post-apply | 11/11 ok, same row counts; `driver_stats` still returns its row to the app |
| security suite | 325 passed |
| full suite | 1859 passed, 0 failed |
| route-auth | 275 passed, 0 failed |
| `npm run db:check` | 118 files valid |
| `npm run build` | succeeded |
| `npm run lint` | 66 errors, all inside `mobile/.expo/**` — gitignored Expo bundle output, not source |

`schema.sql` gained **nothing** from this migration: its diff contains only
unrelated pre-existing drift from migration `113`. That is SEC-DB-004 behaving
exactly as documented — the review artifact is blind to RLS and grants, which is
why `db:contract` is the gate that sees it.

**Still open, deliberately:** the `driver_stats` count query is resolved only
because the view no longer leaks; there is no column-level drift check in either
layer, and a *future* table created without RLS re-opens this class. The
classification gate exists so that cannot recur silently.

## Fixed — 2026-09-18 (SEC-UPLOAD-003 — store the object key, sign on read. Phase B of 2)

**Status: PARTIALLY CLOSED — code closed, data residual open.** The code half is
done; the census below is what forbids calling the finding closed, and the
acceptance condition agreed before implementation said so explicitly.

### The finding

`src/lib/fuel/receipt-storage.js` and `src/app/api/driver/face-photo/route.js`
both called `createSignedUrl` with `60 * 60 * 24 * 365 * 10` — ten years — and
then **persisted the URL**. A signed URL is a bearer credential: anyone holding
the string is authorized for the object until it expires, and the only way to
invalidate one is to rotate the storage key. A ten-year one is effectively
permanent, and it sat in an ordinary readable column.

The reason it could not be fixed by shortening the number is the whole reason
this was a plan and not a one-line change: **the ten-year URL is what the column
held**, and the UI binds those columns straight to `<img src>`. Shorten the clock
first and every already-saved receipt and face photo goes blank — a visible
regression, not a fix. The clock is only safe to shorten *after* the column holds
a key. Order matters; the TTL change is a consequence, never a prerequisite.

### The four columns, not the two that were scoped

The approved plan named two: `fuelrecords.receipt_url` and
`drivers.face_image_url`. The Step 0 census — which is `SELECT`-only — found
**two more**:

| Column | Written by | Found how |
|---|---|---|
| `fuelrecords.receipt_url` | `storeFuelReceipt` | in the plan |
| `drivers.face_image_url` | face-photo route | in the plan |
| `fuelrequests.gauge_photo_url` | **the same `storeFuelReceipt`** | census |
| `employees.avatar_url` | face-photo route (mirror) | census |

`gauge_photo_url` was a genuine gap in the plan's scope: it is a second durable
column carrying the same ten-year tokens, written through the same function, so
it is the same defect class and was fixed with it. It was **not** a silent fix —
it is the single largest scope difference in this phase and is called out here
and in the final report for that reason.

### The census (live, `dnxuphhxlzidvwtdqqkq`, 2026-09-18, read-only)

| Column | total | empty | long-TTL `http` (max len) |
|---|---|---|---|
| `fuelrecords.receipt_url` | 23 | 16 | **7** (413) |
| `fuelrequests.gauge_photo_url` | 19 | 18 | **1** (427) |
| `drivers.face_image_url` | 40 | 39 | **1** (413) |
| `employees.avatar_url` | 64 | 63 | **1** (413, same object as the row above) |
| `license_image_url` / `license_back_image_url` | 40 | 40 | 0 |

Ten rows carry a long-TTL value (7 + 1 + 1 + 1); two of them name the *same*
object, so there are **9 distinct objects**. A token liveness probe (also
read-only) resolved them against storage:

- **4 rows still resolve to a present object** — `fuel_record_id` 116,
  `fuel_request_id` 40, `driver_id` 21, `employee_id` 41 (the last two the same
  object, so **3 distinct live objects**).
- **6 rows are dangling** — `fuel_record_id` 117, 118, 119, 120, 121, 122; the
  objects were deleted, so the token authorizes nothing.
- **No unrecoverable shapes and no foreign hosts** among them.

So the residual exposure is **4 live ten-year bearer tokens** (3 distinct
objects), not 10. The count is stated precisely because "legacy URLs still exist"
and "legacy URLs that still work" are different claims, and only the second one
describes the exposure.

**512-char cap — verified, not assumed.** `isSafeAvatarUrl` rejects anything over
512 chars, and a stored key would be rejected outright (it requires `http(s)`).
A freshly minted 1-hour URL measures **413 chars**, identical to the ten-year
one — the signing parameters do not affect length. So signing before the guard
keeps the avatar inside the cap.

### What changed

- **`src/lib/fuel/receipt-storage.js`** — `FUEL_RECEIPT_TTL_SECONDS` is now
  `60 * 60`, and the module returns `receiptPath` (persisted) alongside
  `receiptUrl` (returned). Adds `toStoredReceiptRef`, `resolveFuelImageUrl`,
  `signFuelReceipt` / `signFuelReceiptList`. `isOwnedFuelImageUrl` now accepts
  **either** an owned signed URL **or** an owned object key, both checked against
  the *same* expected prefix so they cannot disagree about ownership.
- **`src/app/api/driver/face-photo/route.js`** — writes
  `canonicalStoredRef(fileName, FACE_BUCKET)` to both columns; signs **before**
  either write so a signing failure cannot leave a row pointing nowhere.
- **Readers re-sign**: `api/fuel`, `api/fuel/[id]`, `api/fuel/requests`,
  `api/admin/analytics/fuel`, `api/mobile/fuel`, `api/mobile/fuel/[id]`.
  `mobile/fuel/scan` and `gauge-scan` sign the reference themselves rather than
  `fetch`ing what the client sent — a key is not fetchable, and trusting the
  client to hand over something already signed is not a control.
- **The write path canonicalises** — the client is handed a short-lived URL at
  upload and echoes it back on submit, so the server reduces it to a key on the
  way in rather than trusting each client to remember.
- **`src/lib/auth.js`** — signs `face_image_url` / `avatar_url` **before**
  `isSafeAvatarUrl`, since that guard requires `http(s)` and would otherwise
  reject a key and silently blank the avatar on every page.

### Two deliberate deviations, both reported rather than absorbed

1. **`mobile/app/(app)/fuel-report.js` was NOT changed** to prefer
   `receipt_path`. The plan called for it. It is unnecessary: the server
   canonicalises the echoed URL back to its key regardless, so the client change
   does not stop the long-TTL write, and skipping it removes a client/server
   version-ordering hazard. The upload route still returns the path for a future
   client.
2. **`src/app/api/driver/face-photo/route.test.js` was rewritten.** This was a
   *pre-existing* route test that asserted `update[1]` `toEqual([body.face_image_url, 7])`
   — i.e. that the persisted value **equals the signed URL**. That is the defect
   stated as an expectation, and it is what failed on the full-suite run. The
   assertion now requires the stored value to match
   `/^face-captures\/7\/[0-9a-f-]{36}\.jpg$/` **and** `not.toBe` the returned URL.
   That is a strengthening, not a relaxation — but it is a test edited outside
   the security-assessment suite, so it is recorded here.

### Behaviours that changed, and who notices

- A receipt upload URL is now fetchable for **1 hour instead of 10 years**. The
  scan runs within seconds of upload, so the flow is unaffected.
- An `<img>` preview built from a **stale** upload URL breaks after an hour.
- A **dangling** legacy object now reads as `null` rather than as a broken image
  — the SEC-UPLOAD-006 shape, applied consistently.

### Verification — actual output

| Gate | Result |
|---|---|
| Fail-before (Phase B source reverted, tests in place) | **4 failed / 60 passed** — `expected 315360000 to be 3600`; `expected 'https://proj.supabase.co/storage/v1/o…' to match /^face-captures\/4\/[0-9a-f-]{36}\.p…/`; `lib/fuel/receipt-storage.js still mints a ten-year URL`; `expected [ 'fuel-receipts/4/x.png', 3600 ] to deeply equal [ 'fuel-receipts/4/x.png', 315360000 ]` |
| Pass-after (restored, byte-identical to backup) | **64 passed** |
| `src/security-assessment/` | **353 passed** (10 files) |
| `node scripts/verify-route-auth.mjs` | **275 passed, 0 failed** |
| `npx vitest run` (full) | **1921 passed**, 171 files |
| `npx eslint` on every touched file | clean |
| `npm run build` | exit 0 |
| `npm run db:check` | **118** — no migration added |

**NOT EXECUTED:** the browser walk (staff driver page licence image, avatar
chain, fuel receipt modal) against `npm start`, and the mobile device walk. The
echo-back path cannot be exercised from here. Evidence for those is behavioural
tests plus static wiring assertions — compositional, not a rendered image. Stated
as untested rather than assumed to work.

### How the residual actually gets cleared

Neither is included here; both are separate, explicitly-approved actions.

1. **Backfill** — rewrite the 9 rows to object keys. The readers already
   tolerate both shapes, so nothing breaks without it, which is exactly why it
   can wait for its own decision.
2. **Rotate the storage key** — invalidates every outstanding token at once,
   including the 4 live ones, and all 9 rows become dangling (and therefore read
   as `null` rather than as anything). Blunter, and it needs the objects
   re-uploaded.

## Fixed — 2026-09-18 (SEC-UPLOAD-006 — store the object key, sign on read. Phase A of 2)

**Status: SEC-UPLOAD-006 CLOSED. SEC-UPLOAD-003 was still OPEN when this phase
landed; Phase B has since run — see the entry above. Neither phase's code change
cleared the SEC-UPLOAD-003 data residual, which remains open.**
This entry covers Phase A only. Do not read it as closing both.

### The finding, and what the live project said about it

`POST /api/driver/license-scan` minted `getPublicUrl(fileName)` and persisted it
to `drivers.license_image_url` / `license_back_image_url`. `getPublicUrl` builds
an `/object/public/…` URL **without contacting storage**, so on a private bucket
it does not authorize at all. SEC-UPLOAD-006 was carried as **POTENTIAL / NEEDS
VERIFICATION** because its severity ranged from LOW (bucket private — a dead
link) to MEDIUM/HIGH (bucket public — an unauthenticated permanent link to a
photograph of a government ID), and only the deployed project could settle which.

**Step 0 read the live project (`dnxuphhxlzidvwtdqqkq`) before any edit.** Two
readings settled it, and one of them changed the finding:

| Reading | Result |
|---|---|
| `SELECT id, public FROM storage.buckets` | `driver-licenses` is **PRIVATE** |
| rows where `license_image_url` / `license_back_image_url` is non-empty, across 40 drivers | **0** — every shape, including `data:` |

So the URL never authorized and **no stored row was ever affected**. SEC-UPLOAD-006
is **LOW**: a live functional bug in the write path — the desk-facing licence
image would have been a 400 — not an exposure, and not a latent one sitting in
data. The `NEEDS VERIFICATION` test in
`src/security-assessment/upload-storage.security.test.js` is rewritten to
`RESOLVED AGAINST LIVE` with those readings, rather than deleted.

### What changed

**The column now holds an object key; the route signs it on read.** That is the
pattern `expenses/receipt-storage.js` and `driver/incident-storage.js` already
shipped — this generalises it rather than inventing one.

New, in `src/lib/storage/`:

- **`key-format.js`** — a leaf module that imports nothing, so `lib/validation`
  and `lib/storage/object-refs` can share one definition of "is this a key"
  without a cycle (object-refs imports validation, so the format could not live
  in either). The charset is a whitelist, and see the two defects below for why.
- **`object-refs.js`** — `signedUrlFor(bucket, ref)`, `signRefs`, and
  `canonicalStoredRef`. Holds the read half.
- **`lib/drivers/media.js`** — `signDriverMedia(row)` / `signDriverMediaList`,
  the single place a driver-shaped payload has its media columns resolved.

Wired sites: the licence-scan write path stores the key; `drivers/route.js`,
`drivers/[id]/route.js`, `auth/profile/route.js` and `driver/me/route.js` sign
on read. Because the readers sign at the API boundary, **no UI component
changed** — `drivers/[id]/page.js`, the edit form, `use-auth`, `app-shell` and
`user-dropdown` still receive a URL, it just expires.

### Two things that had to be right, and one that nearly wasn't

**Legacy URLs are RECOVERED, never passed through.** Both storage URL shapes
encode the object key deterministically in their path, so the reader recovers the
key and re-signs. An earlier draft of the plan passed a legacy absolute URL
through when the host allow-list accepted it — **wrong, and wrong exactly where
it matters**: a `getPublicUrl` value's host *is* `NEXT_PUBLIC_SUPABASE_URL`, so a
host check waves it straight through, serving a dead image *and* perpetuating the
public-style reference to a government ID. That is the finding itself. The
assertions in `ACCEPTANCE 2 — a legacy getPublicUrl value is recovered and
re-signed, never returned` are written so a pass-through implementation **fails**
them (`expect(url).not.toBe(legacy)` and `not.toContain('/object/public/')`), and
a fail-before probe that reinstated the pass-through confirmed they do.

**The write paths canonicalise.** The readers hand the admin edit form a
short-lived signed URL, and the form submits it back on every save
(`edit/page.js:116,295`). Signing without canonicalising would have persisted a
1-hour URL on every unrelated save — re-creating the SEC-UPLOAD-003 defect
through the read path this fix introduced. `toStoredMediaRef` reduces an echoed
URL back to its key, so the invariant is enforced server-side rather than trusted
to each client. `driver/me`'s `face_image_url` PATCH is canonicalised for the same
reason.

**Two defects were introduced during implementation and caught by tests, not by
review. Both are recorded because a fix that quietly broke something is the
failure mode this whole review exists to prevent:**

1. `parseStoredKey` had no charset rule, so `javascript:alert(1)` — a value with
   no `://` — split into a single well-formed segment and parsed as a **valid
   bare object key**. `isAllowedStoredImageRef` then accepted it as a storable
   image reference. Caught by the existing SEC-UPLOAD-008 suite
   (`other schemes and smuggled credentials do not slip through either`), which
   went red on `expected 400 to be 200`. Fixed with the `KEY_SEGMENT` whitelist.
2. Replacing the `".."/"/"/"\"` checks with that whitelist **dropped the
   dot-segment rejection**, because `.` is in the charset so extensions parse —
   leaving `../../other-bucket/scan.jpg` a legal key that was signed with the
   traversal intact. Caught by the new
   `an unrecoverable reference fails closed and signs nothing`. Fixed with an
   explicit `/^\.+$/` check, and `decodeSegment`'s doc comment now says why the
   charset does *not* subsume it.

Neither reached a commit.

### Verified after applying

| Check | Result |
|---|---|
| `npx vitest run src/security-assessment/` | **346 passed** (10 files) |
| `npx vitest run` (full) | **1914 passed**, 171 files |
| `upload-storage.security.test.js` | 44 → **57** |
| `node scripts/verify-route-auth.mjs` | **275 / 0** |
| `npm run db:check` | **118** unchanged — no migration |
| `npx eslint` on all 10 touched files | clean |
| `npm run build` | succeeded |

**Fail-before / pass-after, with the real failure text.** Reverting the phase's
core behaviour (the reader back to pass-through, the scan back to `getPublicUrl`)
and re-running with the new tests in place produced 5 failures, including:

```
AssertionError: expected 'import { requireDriver, parseBody, ok…' not to match /\.getPublicUrl\(/
AssertionError: expected 'https://proj.supabase.co/storage/v1/o…' not to be 'https://proj.supabase.co/storage/v1/o…'
```

The second is the acceptance-condition-2 assertion catching the pass-through
returning its own input. Restored, the suite is green.

**NOT EXECUTED, and stated as such:** the browser walk (staff driver page
licence image, avatar chain) and the mobile device walk. Neither was performed
here, so the render is **not** browser-verified — the evidence is behavioural
tests plus static wiring assertions, which is compositional, not a rendered
image. An admin opening a driver with a licence scan is what closes that gap.

### Deviations from the approved plan

- **`getIncidentPhotoUrls` was NOT refactored onto `signedUrlFor`.** The plan
  listed it as a pure de-duplication with its existing tests as the safety net.
  It is not behaviour-neutral: the incident reader currently *passes through* an
  allow-listed absolute URL that is not a storage URL, and routing it through
  `signedUrlFor` would drop it instead. That would break two SEC-UPLOAD-005
  assertions which today pin that behaviour as correct — i.e. the safety net
  fails, so it is not a de-duplication. Deferred rather than forced; no security
  benefit is lost, and the incident path is the *template* being generalised.
- **`driver/me`'s `face_image_url` validator widened from `url` to `mediaUrl`.**
  This is the plan's Phase A step 3 and it closes a real gap (`isUrl` is a scheme
  check, so any host was admitted, and the value renders in the staff chrome —
  the same class as SEC-UPLOAD-008). It also **widens what that field accepts**:
  `mediaUrl` admits a strict base64 `data:` image, which `isUrl` refused. No
  producer writes one there, `<img>` does not execute script for a validated
  image MIME, and `driver/me`'s licence fields already accept `base64Url` — so
  the widening is bounded, but it is a widening and is recorded as one.
- **A cross-bucket reference is now expressible.** `toStoredMediaRef` keeps a
  bucket-qualified prefix it finds in the value, so a staff writer could point
  `license_image_url` at a `face-captures` key. That is not an escalation (the
  same writer can already set any allow-listed URL, and can read both buckets),
  but it is a data-integrity looseness introduced by making the prefix
  authoritative — which the design needs, because `employees.avatar_url` receives
  keys from two buckets. Noted, not a finding.

**Still open at the time of this phase, since addressed by Phase B:** **SEC-UPLOAD-003** — `fuel/receipt-storage.js`
and `face-photo/route.js` still mint ten-year signed URLs and still persist them.
Phase B is where that closes, and per the agreed acceptance condition it may be
recorded as CLOSED only if the re-run census finds **zero** live legacy long-TTL
URLs. Phase A's Step 0 census found **10 rows** (fuel 7, face 1, and — not in the
original scope — `fuelrequests.gauge_photo_url` 1 and `employees.avatar_url` 1),
4 of them still live, so the verdict recorded is **PARTIALLY CLOSED — code
closed, data residual open**. Phase A did not touch it. **See the Phase B entry
above for the full census and the liveness split.**



## Fixed — 2026-09-18 (SEC-UPLOAD-008 — the driver routes wrote an unvalidated media ref)

`POST /api/drivers` and `PUT /api/drivers/[id]` destructured `license_image_url`
and `license_back_image_url` straight from the request body and persisted them,
with **both fields absent from `validateBody` entirely** — while every sibling
media endpoint in the repo already routed the same class of value through
`isSafeRemoteMediaUrl`. The same value was then mirrored into
`employees.avatar_url` behind a bare `startsWith("http")` prefix test, which is
a scheme check wearing a host check's clothing.

The four "Or paste Front/Back License Image URL…" inputs removed from the admin
forms earlier the same day were **one of two ways in**. That was a UI change;
this is the write path.

**MEDIUM, and the bound is the honest part.** The writer must already hold
`drivers:create` / `drivers:update` — `requirePermission` guards both routes
(`route.js:222`, `[id]/route.js:127`), and the driver self-service route gates
the same field with `type: "base64Url"` (`driver/me/route.js:219`) plus a second
`isBase64DataUrl` check at write (`:253`), so **a driver could never set a
foreign host**. It is therefore not privilege escalation and not an auth bypass.
It is also **not stored XSS** — `<img src>` does not execute script, and the CSP
`img-src` allow-list blocks the render — and **not SSRF**, because nothing
fetches these columns server-side (`loadScanImage` takes `file_url` from the
request body, never from the row). What remained was a defence-in-depth gap: a
privileged writer plants a foreign-host reference that renders for *other* staff
(`drivers/[id]/page.js:121`, and `employees.avatar_url` through the global chrome
at `app-shell.jsx:348` and `user-dropdown.jsx:52`), beaconing each viewer's IP.
CSP was the only control behind it.

**A census of live data changed what this finding is.** Across 40 driver rows,
`drivers.license_image_url` and `license_back_image_url` hold **zero non-empty
values**; `employees.avatar_url` holds one, on the allow-listed Supabase host.
So the finding **never manifested in stored data** — it is a live defect in the
*write path*, not an exposure of existing records. It is recorded that way.
The same census is what ruled out the only real risk in the fix: if a row held a
value the new rule rejects, the admin edit form would start 400-ing on save with
no way to clear it. None does.

**The fix.** `isAllowedStoredImageRef` (`src/lib/validation/index.js`) — an
inline base64 image, or a URL on a fleet-controlled origin — exposed as a
`mediaUrl` type in the existing map at `helpers.js:144`. It routes `data:` to the
**strict** `isBase64DataUrl` on purpose: the guard short-circuits `true` on any
`data:image/` prefix (`remote-url.js:34`), which would admit
`data:image/svg+xml,<svg …>` and every malformed payload with it. Wired into both
`validateBody` schemas and both `avatar_url` copies. The **512-char cap on the
avatar copy was kept deliberately** — it is why a multi-megabyte scan data URL
has never been copied into `employees.avatar_url`, and that behaviour is not this
finding's to change. `validateField` returns early for `undefined`/`null`/`""`
(`helpers.js:130`), so the fields stay optional for free.

**Fail-before / pass-after, with one honest caveat.** Reverting the route changes
and re-running: the SEC-UPLOAD-006 assertion that pinned the old weak pattern
failed, as did every SEC-UPLOAD-008 assertion. The behavioural test reported
`expected 500 to be 400` — pre-fix, validation let the value through and
execution ran past the boundary into the DB layer, which the harness leaves
unmocked. **That 500 is a harness artifact, not production behaviour**: with a
real client that path returns 200 and writes the row. The test proves validation
refused nothing before the fix; it does not, by itself, demonstrate a written
row. SEC-UPLOAD-006's `startsWith("http")` assertion was **rewritten to assert
the new contract**, not deleted or relaxed.

**Verified after applying:**

| Check | Result |
|---|---|
| Step 0 live census | `license_image_url` 40/40 empty, `license_back_image_url` 40/40 empty, `avatar_url` 1 http on the allow-listed host — **0 non-conforming** |
| `upload-storage.security.test.js` | 43 passed (was 36); **fail-before confirmed by reverting the guard** |
| security suite | **332 passed, 0 failed** (was 325) |
| full suite | **1900 passed, 0 failed** (was 1893) |
| route-auth | **275 passed, 0 failed** |
| `npx eslint` (5 touched files) | clean |
| `npm run build` | succeeded |
| browser walk | **NOT EXECUTED** — see below |

**Not executed, and not claimable.** The browser walk on the licence surfaces
could not run: there are **zero stored licence references**, so there is no real
data to render. The accept-direction coverage is at the rule level (a Supabase
`getPublicUrl` shape, `readAsDataURL` output and `canvas.toDataURL` output all
return true) plus static wiring assertions on all six sites — which is
compositional evidence, **not** a browser-verified render. An admin creating a
driver with a scan is the only thing that closes that gap, and it needs a
mutation.

**Still open at the time of this fix, and since changed:** SEC-UPLOAD-003 (the
ten-year signed-URL TTLs) and SEC-UPLOAD-006 (`getPublicUrl` on the private
`driver-licenses` bucket — whose `avatar_url` assertion this fix rewrote, but
whose subject was untouched). This closed one write path; it did not close the
driver-licence storage problem. **SEC-UPLOAD-006 was closed the same day by the
object-key work above** — the `avatar_url` assertion it rewrote then had to move
again, from `license_image_url` to `storedLicenceFront`, because the guard now
sits on the canonicalised value. The contract is unchanged. **SEC-UPLOAD-003
remains open.**

## Fixed — 2026-09-17

All four findings come from the FleetMate scenario suite ([[FleetMate Scenario
Test Suite]]). The two defects were first recorded here as open with **deliberate
failing assertions** as their evidence; the remediation plan was approved and
applied the same day, and those assertions now pass. A fifth defect — introduced
by the first fix and caught reviewing the diff — was closed with it, and the
suite gained FM-EVID-014 as its regression. Closing that one surfaced two more in
the same proof path; both were fixed under a second approved plan the same day
(sixth and seventh below). A third plan the same day closed the last one — the
fail-open in `resolveLeave()` that the first two plans had reported and left open
(eighth below). **Nothing the suite found remains open:** the suite's counts grew
102 → 109 → 110 as it found each one, so those are successive states of one file,
not a decomposition of a single run.

- **A leave-sourced driver block opened the wrong evidence family — HIGH, FIXED.**
  `proofTypeForRecovery()` (`src/lib/dispatch/evidence-contract.js`) read
  `recovery.hint` — the static template from `recoveryForCheckId()` — and never
  the check's own `message`, which is where the recorded reason lives. A pair
  blocked with *"Driver is on approved leave during this time."* therefore minted
  a **`schedule_conflict`** proof instead of **`leave`**. The two resolve
  different record families: `schedule_conflict` reads overlapping
  `dispatchschedules`, which can legitimately return *clear*. So the Evidence
  Drawer could show a clear schedule snapshot for a driver the chat just said is
  on approved leave — a chat/evidence contradiction on the surface whose entire
  purpose is to prove the chat.
  - **Fix.** Classification now tests the recorded `message` first and falls back
    to the hint, which is the only carrier an exclusion action has (it is built
    from a reason string, not a check). A leave block's ref is also scoped to the
    **driver** rather than the vehicle, matching the leave clearance row.
  - **Verified.** FM-EVID-012 asserts a leave block opens `leave` scoped to
    driver 4, and FM-EVID-013 now pins the wiring in both directions — a leave
    message classifies `leave`, a rest-day message stays `schedule_conflict`, and
    a message-less exclusion action still classifies from its hint.
  - **Follow-on defect the fix introduced — closed the same day.** Scoping the ref
    to the driver is only sound where a driver is known, and an **exclusion** row
    has none: `dispatch-radar.service.js` builds `none_reasons` from an INFEASIBLE
    pair as `{vehicle_id, reason}`, so `recoveryActionForExclusion` gets no
    `ctx.driverId` and leaves `id: null`. Those rows never classified as `leave`
    before the fix, so the gap was unreachable; afterwards a leave *reason* on an
    exclusion began minting `{type: 'leave', driverId: null}` — and `resolveLeave()`
    with a null driver builds `WHERE driver_id = NULL`, matches nothing, and
    returns `{verdict: 'clear'}`. That is a drawer **clearing** a driver the chat
    just said is on leave: the same contradiction class as above, through a new
    door, and reachable in production. Found reviewing the diff, not by a test.
    - **Fix.** `sign()` mints no ref for a **driver-sourced** block
      (`record: 'driver' | 'schedule'`) that has no id — generalized from `leave`
      alone. A probe with the guard disabled showed **three** families reaching it,
      each resolving a different wrong record: `leave` (no row → `clear`),
      `schedule_conflict` (`driver_id=$1 OR vehicle_id=$2` silently narrowing to a
      vehicle-only check), and `compliance` (the vehicle branch, so a licence
      problem reports registration/insurance). Every other proof family is
      vehicle-scoped and unaffected.
    - **Verified.** FM-EVID-014 — all three families carry no proof on an exclusion
      while the same reasons on a pair still mint, scoped to the driver. Confirmed
      to bite by temporarily disabling the guard: the file reported `1 failed | 13
      passed` with FM-EVID-014 the only failure, i.e. nothing else covered it. A
      separate probe (since deleted) confirmed which families the guard holds.
    - **Reported, then fixed the same day — the eighth defect below.**
      `resolveLeave()` failing open on a null driver is a defect in the resolver
      itself (classified **B** — deterministic service layer): the guard stops the
      Copilot path reaching it, but another caller could, and a ref minted before
      the guard existed stays resolvable for its TTL. Recorded here as reported
      rather than fixed, then closed by a third approved plan; see the entry
      below.
- **A licence proof opened the vehicle's registration — HIGH, FIXED.** Found while
  closing the follow-on above, and the same root cause: a signed `ev_` ref carried
  *who* it was about (`vehicleId`/`driverId`) and *what family* to read
  (`proofType`), but never **which of the two identities the claim was scoped to**.
  `resolveCompliance()` filled that gap by inference, vehicle-first
  (`if (vehicleId != null)`), and **every** pair-path compliance ref carries a
  vehicleId — so a proof for *"Driver license is expired."* returned the vehicle's
  `registration`/`insurance`. The drawer opened *Compliance Block* on documents
  unrelated to the block it exists to support. Reachable on the **normal pair
  path**; the FM-EVID-014 mint guard could not cover it, because the driver id was
  present — the resolver simply never read it.
  - **Fix.** The ref now carries a validated `subject: 'vehicle' | 'driver'`
    (`COMPLIANCE_SUBJECT_BY_CHECK` for clearance checks, `COMPLIANCE_SUBJECT_BY_CODE`
    for recovery codes — one definition read by both mint sites and the resolver),
    and `resolveCompliance` branches on it instead of on whichever id happens to be
    non-null. `sign()` also stops recording the vehicle as the record for a licence
    block. A ref minted before the field existed verifies but is **refused**
    (`UNSCOPED` → 404) rather than guessed at; the 15-minute TTL clears it on the
    next Copilot run, so no in-flight ref needed migrating.
  - **Verified.** FM-EVID-015 (a licence ref resolves the driver branch *with a
    vehicle id present*, and no vehicle fact survives), FM-EVID-016 (registration/
    insurance keep the vehicle subject), FM-EVID-019 (a subjectless ref is refused,
    and an undefined subject cannot be minted), FM-EVID-020 (a validly-signed ref
    with a bogus subject is `TAMPERED`). Mutation check: reverting `resolveCompliance`
    to vehicle-first makes FM-EVID-015 fail with `subject: 'vehicle'` where
    `'driver'` was required.
- **A pairing proof read the vehicle id as its driver — MEDIUM, FIXED.**
  `decision.js` records a pairing block as `{ record: 'schedule', id: <vehicleId> }`
  (the *Check substitute schedule* button navigates to the vehicle record), and
  `sign()` read `record: 'schedule'` as *"the id is the driver"*. So a pairing ref
  was signed with `driverId = <vehicleId>`; `resolvePairing` then queried
  `vehicle_id=V AND driver_id=V`, matched nothing, and returned
  `{verdict: 'blocked', pairingState: 'none'}` — a definitive negative from a check
  that never ran. Worse, `EVIDENCE_ALLOWLISTS[PAIRING]` admits `driverName` and
  `resolveEvidence` enriches it from `refData.driverId`, so a *Pairing Evidence*
  drawer could print the name of whichever driver happens to share that number.
  - **Fix.** A pairing ref takes its driver from the pair (`pairCtx.driverId`) —
    the only place the real answer exists. `resolvePairing` returns
    `{verdict: null, pairingState: null}` for a null driver, the `resolveGps`
    posture, which the drawer renders as *—* rather than as a claim (the drawer
    prints any unrecognized verdict string verbatim, so `'unknown'` was not an
    option). `decision.js` was deliberately **not** changed: its `record` value
    drives fix ordering and navigation through `RECOVERY_RECORDS`. The FM-EVID-014
    mint guard was made identity-aware rather than exempting pairing, so a pairing
    action with no vehicle identity still mints nothing.
  - **Verified.** FM-EVID-017 asserts the ref carries the pair's driver and, more
    importantly, that the SQL was issued with `[9, 6]` — the parameters, not just
    the outcome, are what show which record was read. FM-EVID-018 asserts an
    unevaluated pairing queries nothing and claims nothing. Mutation checks: the
    driver-sourcing revert fails FM-EVID-017 with `driverId: 9` (the vehicle), and
    disabling the null-driver early return fails FM-EVID-018 with
    `expected 'none' to be null`.
- **A repositioning candidate was shown GPS *Unknown* instead of *not
  applicable* — MEDIUM–HIGH, FIXED.** `buildInspectorRows()`
  (`src/components/reservations/evidence-drawer.jsx`) branched on
  `meta.horizon === 'REPOSITION'`, but `REPOSITION` is a `dispatchContext`
  **mode** — a separate taxonomy — and a repositioning candidate's horizon is
  `NEAR_DISPATCH`/`LAST_MINUTE`. The branch was unreachable in production, so the
  GPS row fell through to *"GPS Health: Unknown"*, narrating an **intentional**
  absence of live evidence as **missing** evidence — which `LIVE_EVIDENCE_RULES`
  explicitly forbids.
  - **Fix.** The mode is projected as a label (`dispatchMode`, beside the
    existing `gpsHealth` label — never `originType`, `previousDispatchId` or
    standby coordinates) and carried into `clearanceMeta.mode`; the inspector
    tests **mode** and horizon independently, since each excludes live location
    for its own reason.
  - **Verified.** FM-DRAW-014 asserts the repositioning row reads *Current GPS —
    Not applicable* with the rendered drawer free of the word *Unknown*, and that
    the same projection on an `IMMEDIATE` mode still reports an absent reading as
    *Unknown* rather than *not applicable* — the mode decides, not the absence.
- **`recoveryForCheckId('schedule')` assumes a driver-sourced block — LOW,
  ADDRESSED BY DOCUMENTATION.** It always resolves to `DRIVER_UNAVAILABLE` /
  *Pick an available driver*, which would mislabel a vehicle fault. The check
  does group four conflict types (`conflicts.js:592`), but the two vehicle-sourced
  ones are removed upstream (the SQL pre-filter in `fetchCandidates`, and
  `_schedule_load > 0` skipped in `pair-scoring.js`). Rather than invent a prose
  heuristic — `recoveryActionForCheck` is explicitly forbidden from classifying by
  display text — the dependency is now documented at the mapping and frozen by
  FM-VEH-007, so widening either filter fails the suite instead of silently
  mislabelling.
- **The single-option explanation invited a comparison that could not exist —
  LOW, FIXED.** `rankDispatchPairs` gave a lone option `ONLY_OPTION` /
  *Only evaluated option* but the generic *"Compare the current evidence before
  choosing."* It now says *"This is the only evaluated option, so there is
  nothing to compare it against."*; the generic sentence is retained for the
  multi-pair fallback it was written for. FM-RANK-010 pins the new sentence.

- **`resolveLeave()` cleared a driver it never looked up — MEDIUM–HIGH, FIXED.**
  The last fail-open in the proof path, and the one the first two plans reported
  and deliberately left open. Asked with no usable driver, `resolveLeave`
  (`src/services/evidence-resolve.service.js`) built `WHERE driver_id=$1`, matched
  no row, and took its *"no overlapping leave"* branch — returning
  `{verdict: 'clear'}`. That is a **clearance for a driver nobody looked up**,
  sitting under a check the drawer renders as *verified*, and it is the one
  direction of error that matters in a proof whose purpose is to support a block.
  The FM-EVID-014 mint guard narrowed the surface without closing the defect: it
  stops the Copilot path minting such a ref, but the resolver stays callable that
  way by any other caller, and a ref minted before the guard existed stays
  resolvable for its 15-minute TTL.
  - **Why it survived earlier review — the dangerous value is `0`, not `null`.**
    The projection coerces ids with `Number()` (`conversation.js:36`), so an
    **absent** driver does not arrive as `null`; it arrives as `0` (and
    `Number(undefined)` as `NaN`). `0` fails no check anywhere: it is not null, so
    a `!= null` guard passes it, and `driver_id = 0` is a clean, valid query that
    matches no row. Nothing upstream looks wrong and nothing downstream errors, so
    the wrong answer is well-formed and looks like every other answer.
  - **Fix.** Definitional before behavioural. The contract now exports one
    predicate, `usableRecordIdentity(value)`, admitting only a **positive safe
    integer** and returning `null` for everything else — covering `null`,
    `undefined`, `0`, `NaN`, negatives and non-integers in a single place, so the
    mint sites and the resolver cannot drift apart about what an id is. All three
    sites read it: the leave-clearance mint in `attachClearanceProofs`, the
    recovery-path guard in `sign()`, and `resolveLeave` itself, which now returns
    `{verdict: null, overlapsBooking: null}` and **issues no query at all** — the
    `resolveGps` posture, applied for the third time in this file.
  - **Second hole closed as a side effect.** The recovery-path guard was
    **tightened** rather than merely re-pointed: it previously tested only
    non-null plus safe-integer, so a licence block carrying id `0` passed it and
    went out scoped to a driver that does not exist.
  - **Verified.** FM-EVID-021, both mint sites and both directions: the clearance
    row is present with `proof: null` while its sibling stays intact; resolving a
    hand-minted null-driver ref returns no claim **and issues no query** (the
    assertion is on the captured SQL list being empty, not on the outcome, so it
    proves the question was never asked); a real driver with no overlapping leave
    is still reported `clear` **and** still issues exactly one query, so the guard
    does not swallow the legitimate answer; and a driver-sourced block carrying id
    `0` now mints no recovery proof. Mutation checks — each site disabled in turn:
    `expected 'clear' to be null` (resolver), the clearance row carrying a proof
    again (mint guard), `expected { type: 'compliance', …(1) } to be null`
    (tightened predicate). All restored; `grep -rn "PROBE" src/` returned nothing.
  - **Carried forward, not fixed:** the `schedule_conflict` clearance row can
    still silently narrow to a vehicle-only check when the driver is unusable,
    since `resolveScheduleConflict` matches `driver_id=$1 OR vehicle_id=$2`. Its
    impact is a narrowing rather than a false clearance, and closing it needs the
    same predicate applied to a resolver with two legitimate identities — a
    different question from the one this fix answered. No approved plan covers it.



## Fixed — 2026-09-17 (found by live measurement, not by the suite)

A different instrument, the same day. `scripts/fleetmate-live-probe.mjs` puts the
real `deepseek-chat` model through scripted cases and measures the honesty
contract against what the model *actually* wrote, rather than against a
deterministic path that was already compliant. It found two defects, and they are
the first in this file that **the suite did not and could not find**. They are
registered in [[FleetMate AI Scenario Validation Report]] §12.7 and §12.8 as
**Defect 7** and **Defect 8**; the numbering there is the register of record, and
this section is the engineering note behind it. Both were closed the same day by
one approved plan: server-owned narration guards.

- **A truncated evaluation was presented as exhaustive — HIGH, FIXED. THE FIRST
  CLASS-D DEFECT IN THIS FILE.** The live probe's case 8 bounded the evaluation —
  only the pairs the server had actually checked — and the model answered as
  though the bound were the whole fleet. The dispatcher's question was answered
  correctly *within* the window it was evaluated over, and nothing in the answer
  said there was a window.
  - **Why the suite passed while the defect was live.** FM-ADV-008 already covers
    this exact rule, and it passed throughout — because the **deterministic**
    path (`evidenceSummary`) did disclose the bound. The obligation was carried
    on the *narrated* path, where the model owned it, and a deterministic test
    cannot observe a sentence the model has not written yet. Every earlier defect
    in this file was reachable by a deterministic test: the service layer, the
    projection, the evidence contract and the UI were all assertable. This one
    was not, which is what makes it a new class rather than a new instance.
  - **Fix.** The disclosure sentence moved to the server:
    `coverageDisclosure()` / `withCoverageDisclosure()` in
    `src/lib/dispatch/conversation.js`, wired into the `answer` assembly in
    `.../conversation/route.js`. The model may still narrate anything it likes
    about the pairs it was given; it can no longer be the thing that decides
    whether the bound gets mentioned.
  - **Verified.** FM-ROUTE-008, and the fix was proven to have teeth by reverting
    the call and confirming exactly that assertion fails with the bound absent.
  - **The nondeterminism, measured after the fix — this is the part that settles
    it.** Re-asking the same question against the same truncated evaluation twice
    produced different behaviour: on the first extended run the model disclosed the
    bound unaided (*"One caveat: the list is truncated, so this isn't the whole
    fleet"*), and on the **second, identical run it did not**. The server's sentence
    disclosed it in both. Before this, "the model cannot be trusted with this
    obligation" was an argument from the original failure; it is now an observation
    with a counter-example inside one data set, which also forbids reading the
    clean runs as a rate.
  - **Class.** D in the report's taxonomy: a governing rule correctly implemented
    one layer down and left to narration one layer up.
- **The chat read a deliberate GPS exclusion as "unknown" — MEDIUM, FIXED. A
  PROPAGATION FAILURE, NOT A JUDGEMENT CALL.** Live probe case 5, both runs. Run
  1 answered *"it's unknown - not offline or no signal"*; run 2 answered *"GPS
  status isn't supplied…"*. Both narrate an **intentional** absence of live
  position as **missing** evidence — the reading `LIVE_EVIDENCE_RULES` exists to
  forbid. The pair had been evaluated on a planning horizon (and, in the
  repositioning fixture, as a repositioning dispatch), where live location is not
  used at all.
  - **This had already been found and fixed — in the drawer, never in the chat.**
    `evidence-drawer.jsx:235` carries `liveInapplicable = horizon === "FUTURE" ||
    horizon === "SAME_DAY" || meta.mode === "REPOSITION"`, with a comment
    explaining that testing it as a horizon alone had rendered the deliberate
    exclusion as *"GPS Health: Unknown"*. FM-DRAW-014 asserts it. So the correct
    rule existed, tested, **two layers away**, and had simply never been carried
    to the chat. That is precisely a propagation failure: not a rule anyone had
    to invent, but a rule nobody had propagated.
  - **Fix.** `src/lib/dispatch/narration-guards.js` — `narrationGuards()` /
    `guardDisclosure()` / `withGuards()`. When the question is GPS-topic and an
    in-scope pair carries no `gpsHealth` on a planning horizon or as a
    repositioning dispatch, the server appends its own sentence naming the reason.
    The chat and the Evidence Drawer can no longer disagree about whether live
    location applied.
  - **Verified.** FM-GUARD-001 and FM-GUARD-002 assert the required clause against
    the **live answers quoted verbatim as constants** — the failure mode is now a
    permanent regression rather than a transcript — and FM-DRAW-015 asserts the
    two layers agree across all five shapes. The GPS predicate is a deliberate
    **mirror** of the drawer's, not a shared import, so this change stays additive;
    drift fails FM-DRAW-015 instead of silently diverging.
- **Three further narration obligations closed with the same mechanism — the
  plan's actual scope.** Cases 5 and 8 were the two the probe *failed*; cases 4,
  9 and 10 were the ones it **passed by luck**. Each is a closed fact about
  `(question, evidence)` rather than a judgement, so each was moved to the server
  beside the coverage disclosure:
  - **Case 4 (injection), the outcome half.** A turn that asserts an entity is
    free, or that a record was cancelled or should be ignored, while the server's
    evidence for that entity is `BLOCKED` or `INSUFFICIENT_DATA` — the
    contradiction clause restates the evidence. The **input-recognition half
    stays open**, and it was then *measured* rather than argued: the probe grew
    six residue cases (11–16) that exercise phrasings asserting nothing about the
    evidence, and five of the six meet no guard at all. The sixth — an authority
    frame — fires only because the phrase "override authority" matches the
    `overrid` stem, which is a slightly **wider** guard set than this note first
    claimed; the run made that visible rather than assumed, since the case had
    been written as a residue candidate and came back `FIRED
    ["contradicted-availability:9/4:BLOCKED"]`. The model's own prose held on all
    six in each execution; that is a count over a scripted set, not a rate, and no
    regex enumerates unknown phrasings, so the recognition half stays open.
  - **Case 9 (probability).** A question asking for a rate, a promise or
    punctuality gets the refusal clause. It is worth noting *why* this needed
    owning: the live answers did refuse, but one of them contained the word
    "guarantee" while refusing — which is why the honesty predicates are asserted
    on the **server's appended block**, never on the assembled answer.
  - **Case 10 (entities).** An id named in the question that appears in neither
    the evaluated pairs nor the recorded exclusions is reported absent. Numeric
    `vehicle N` / `driver #N` ids are closed; plate-shaped tokens are
    **best-effort** and a miss is residue.
- **`Flagged` — observability for guard frequency, deliberately outside the error
  rate.** When a guard fires on a narrated answer the route writes a `logAiRequest`
  row with `provider_name: 'Narration Guard'`, `model_name: 'Deterministic
  Guard'`, `status: 'Flagged'` and the fired labels in `error_message`. `'Flagged'`
  was chosen over `'error'` on evidence: `ailogs.status` is a plain
  `varchar(20)` with no CHECK, and **both** AI error counters match
  `ILIKE 'error'`, so a guard firing is visible in the table without inflating the
  error rate or entering the review queue. Accepted consequence, stated rather
  than discovered later: Flagged rows are observability only.
- **The hazard that record introduced, and its direct test — worth recording
  because the near-miss was in the *test* suite, not the app.** `logAiRequest`
  swallows its own errors, and **no test mocked `@/lib/ai/logger`** anywhere in
  `src/`, while `vitest.config.mjs` loads no environment. So a developer running
  `npm test` in a shell that happened to export `DATABASE_URL` would have had the
  guard tests **insert real rows into the production `ailogs` table** — a silent
  violation of the standing "do not alter production data" rule, caused by a test.
  Closed with one line in the affected suite
  (`vi.mock('@/lib/ai/logger', () => ({ logAiRequest: vi.fn(async () => {}) }))`),
  which also made the flag assertable instead of merely tolerated. Proven closed
  directly rather than by inspection: the focused scope was re-run with
  `DATABASE_URL` exported, and `ailogs` was **1230 rows / max `log_id` 1230 /
  0 Flagged before and after**, with zero rows above the watermark.

- **The instrument lied before the model did — LOW, FIXED. Recorded because it is
  the same class of error as the defects above.** The first extended probe run
  reported case 8 as a violation. The model had complied; the probe's own
  `DISCLOSES_LIMIT` pattern ended in `\b`, making its `truncat` stem unmatchable
  (no word boundary inside "truncated"). A **false failure**, found only because
  the probe prints the raw answer beside every verdict — which is now the stated
  reason that layout is mandatory rather than cosmetic. Fixed (`truncat\w*`,
  trailing boundary dropped, leading `\b` kept so "unlimited" cannot match
  "limited"). One check was **re-pointed** as a consequence, and that is disclosed
  rather than done quietly: case 8's assertion now reads the *delivered* answer
  (prose plus the server's sentence) because the obligation has been server-owned
  since the fix above, and the model's own disclosure is preserved as a per-run
  **observation** instead of being dropped. The justification is in the data — the
  check would otherwise flap with the model, which is exactly the failure mode
  that makes a suite's red meaningless.

**What this section does not claim.** The model's prose is returned verbatim and
is never retracted or rewritten — `SEC-AI-007` pins that, and it is a hard design
constraint, so a guard makes the *answer as a whole* carry the server's sentence
while the model may still have written something wrong above it. The two runs
behind this section were ten calls each; the probe now makes twenty-one per run,
and either figure is a **sample** of a nondeterministic system, reported as an
observation and never as a rate, and never as "the AI cannot be prompt-injected".
And nothing here enters the scenario count: the live layer is a separate layer,
reported separately.

### Follow-up, 2026-09-18 — the guards no longer depend on the model being asked

The guards above are keyed on **the question**. That left an obligation the model
could discharge or not at its own discretion: cases 17 and 18 raise no topic at
all ("What should I check next?", "Summarize the situation in two sentences.") and
the model **volunteered** a GPS misread and a rate respectively, both times, with
no guard in a position to notice. Closed rather than documented, because the
condition turns out to be a closed function of the model's own text.

- **A refusal is not a claim, and that is the whole difficulty.** "I can't give a
  success probability" carries the banned token and is *compliance*. So the
  volunteered guards cannot be bare regexes. The needed matcher already existed —
  but only inside `scripts/fleetmate-live-probe.mjs`, as `NEGATION` /
  `CLAUSE_BOUNDARY` / `clauseHead()` / `forbidMatch()`, where it told a claim from
  a refusal by the clause a match sits in rather than by a fixed character window.
  It was **extracted, not reimplemented**, to `src/lib/dispatch/clause-polarity.js`
  (`assertionMatches`), and the probe now imports it. The point is not tidiness:
  a guard and the test predicate that judges it would otherwise be two copies of
  one honesty rule, and two copies drift. The extraction changed no existing
  verdict — the live strings it was exercised on are already pinned as constants
  in `narration-guards.test.js`.
- **`volunteeredRate` / `volunteeredLocation`.** Each reads the model's prose and
  is gated on its question-side counterpart being false, so a turn never states
  the same sentence twice. `guardDisclosure` gained **no new wording**: both
  triggers emit the existing `probabilitySought` and `gpsNotApplicable`
  sentences, which `FM-GUARD-007` already proves satisfy the group M honesty
  predicates — so the reused text is re-proven rather than assumed clean.
- **These are asserted deterministically and only *observed* live, and the
  distinction is deliberate.** The model may simply not volunteer a claim on a
  given run, so an asserted live check would flap — the same failure mode that
  made the flapping suite's red meaningless (above). The guards are therefore
  pinned with mocked answers in `narration-guards.test.js` and `FM-ROUTE-009`,
  and the probe reports whether they fired as an **observation**. On the
  2026-09-18 run neither did, and the transcript records the reason: the model
  volunteered nothing on those two turns, which is not the same as a detector
  missing something.
- **Scope was a stated obligation at this historical point** — the deterministic
  route-edge classifier and `scope-only` short-circuit were added in the
  2026-09-18 follow-up above, so the current status is the closed item under
  Severity 2.



## Fixed — 2026-09-17 (security assessment — the six findings, five remediated)

An authorized assessment of this repository produced **1 High, 3 Medium and 6 Low**
findings plus 8 observations, then a separate approved plan remediated them. The
authorization model itself held under every bypass attempt — no unauthorized
assignment, no privilege escalation, no cross-tenant read. Every gap sat at the
edge of an individual control, never in the permission matrix. The
`src/security-assessment/` suites are now the regression guard.

The acceptance rule for all of this: **a finding is not closed until its test
fails against the old code and passes against the new.** Both halves were
demonstrated for each fix (8 failures on Batch A, 12 on Batches B/C/E) by
reverting the touched files to `HEAD`, running, and restoring.

- **The travel+buffer safety gate was fed by the request body — HIGH, FIXED.**
  `src/app/api/integration/transport-requests/[id]/assign/route.js` built the
  §4.8.3 ETA from `body.travel`. Omitting that key skipped the gate entirely, and
  a forged low `etaMinutes` cleared it — both silently, and neither left the
  `override_reason` record the sanctioned `force: true` path demands. The design
  plainly intends every override to be recorded; this path was not.
  - **Fix.** A new `src/lib/scheduling/travel-signals.js` derives the ETA
    server-side: previous commitment's drop-off → this request's pickup, through
    `tomtomEtaMinutes`, falling back to straight-line `etaFromDistanceKm`, else
    UNKNOWN. The caller's number survives only as a **cross-check** — divergence
    past `TRAVEL_ETA_DIVERGENCE_MIN` (15) raises a `TRAVEL_ETA_DIVERGENCE`
    WARNING and never becomes the gated value.
  - **The fail-open was preserved, not reversed.** The assessment's first report
    called this an oversight; it is not. `travel-buffer.js` and `conflicts.js`
    both document "the gate can never fabricate a conflict from absent data", and
    a test asserted it. So the fix **splits** the double null-guard instead: no
    prior commitment still fails open (unchanged, still tested), but a prior
    commitment with **no computable ETA** now raises `TRAVEL_BUFFER_UNVERIFIED`
    at WARNING — visible to the dispatcher, non-blocking, never a 409.
- **Incident evidence accepted any host — MEDIUM, FIXED.** The write path did
  `new URL(value)` then a path check with **no host comparison**, so
  `https://attacker.example/storage/v1/object/sign/incident-evidence/4/x.png`
  recorded an attacker-chosen URL as fleet evidence. Both staff viewers bind that
  column straight to `<img src>`, so the reviewing browsers — not the server —
  were the ones calling out. Fixed with the repo's existing `isSafeRemoteMediaUrl`
  allowlist, on the **write path and the staff read path**: rows written before
  the fix can already hold arbitrary URLs, so the read path re-checks rather than
  trusting the column.
- **Client-supplied file extensions — LOW, FIXED.** `fuel/receipt-storage.js` and
  `expenses/receipt-storage.js` took the extension from `file.name?.split(".")`.
  A `receipt.html` declared `image/png` was stored as `<uuid>.html` under
  `Content-Type: image/png` — exactly the disagreement a content sniffer is built
  to resolve. Both now use the extension the magic-byte validator returned, as
  `vehicles/[id]/image/route.js` already did.
- **Signature validation was skippable — LOW, latent, FIXED.** `validateImage`
  guarded the magic-byte check behind `if (bytes)`, so a caller omitting the
  buffer downgraded to trusting the client's own `Content-Type`. All four call
  sites passed bytes, so it was never reachable — but nothing said so. `bytes` is
  now required and raises a `TypeError`.
- **`AuthError` shipped a session code on non-session failures — INFO, FIXED.**
  `code = "SESSION_INVALID"` defaulted unconditionally, so every 403 role denial
  and every 404 told the client its session was dead. Nothing acted on it (both
  consumers read `code` only under `status === 401`); the envelope just stopped
  lying.
- **`img-src` admitted every https host — LOW, FIXED.** `next.config.mjs` had
  `img-src 'self' data: blob: https:`, which is what let the evidence URL above
  leave the browser even once the write path refused it. Now narrowed to the
  storage and app origins — derived from the same env vars
  `remote-url.js` uses, so the two lists cannot drift — plus the three map hosts.
  **`script-src` still carries `'unsafe-inline'`**: moving it off needs a nonce
  and a `src/proxy.js` matcher widened past `/api/:path*`, which is a real
  regression risk for a finding with no exploit path. Deliberately deferred, not
  silently skipped.

### Reported but deliberately NOT applied — the plan was wrong here

Two approved items would have been **functional regressions**, and were stopped
rather than forced. Both were replaced with an in-suite `OPEN` regression test
that documents the reasoning, so the next person does not "fix" them either.

- **Shortening the capability-URL TTLs is unsafe as specified.** The plan was to
  cut `60*60*24*365*10` → `3600` on fuel receipts and the driver face photo. Both
  URLs are **persisted into durable columns and bound directly to `<img src>`** by
  long-lived UI (`components/fuel/receipt-verification-modal.jsx`,
  `api/auth/profile/route.js`). A one-hour TTL breaks them at the hour mark — the
  face-photo route's own comment already says the URL "would rot in the column
  within the hour". The correct remedy is the expense pattern: **store the object
  key and re-sign per read**, which needs a migration, re-signing readers, and a
  compatibility story for the URL the mobile client is handed at upload and echoes
  back. Separate work.
- **Flipping `driver-licenses` private is unsafe as specified** for the same
  reason: every already-stored URL would 403. The defensive migration makes the
  *read* unnecessary, not the problem solved.
- Already-issued ten-year URLs stay valid until they expire regardless — revoking
  them means rotating the Supabase storage signing key, an operational action.

Verified: full suite `1832 passed / 169 files`, `verify-route-auth` 275/275,
`db:check` 116 valid, eslint clean on every touched file, `npm run build`
succeeds, and the built `routes-manifest.json` carries the narrowed `img-src`.
**Nothing was committed.**

## Fixed — 2026-09-16

- **No maintenance record could be completed, by anyone, since 2026-09-04 — and the error message changed with your role.** Two guards stacked on the `Completed` transition, each keyed to the wrong thing:
  - **The repairer was read as `created_by`.** That column records the work order's *provenance*, and on an incident-sourced ticket it holds **whoever resolved the incident** (`src/lib/incidents/maintenance.js:71`), not the mechanic. Live rows 39/40/44/45 all carry `created_by = 48` — the `admin` account — so that admin was permanently locked out of work orders it had opened itself and got `403 "Mechanics cannot approve their own repairs. Manager inspection required."` A `fleet_manager` who had never touched the record passed this guard and hit the next one.
  - **The inspection gate was unsatisfiable.** Migration 097 made `inspection_required` default `TRUE`, and the route then required `inspection_completed_at` before `Completed` — but a repo-wide grep found nothing outside the route, its test, `schema.sql` and the migration itself that could ever *write* that column. Hence the manager's `400 "Inspection must be completed before marking as Completed"`. A gate with no writer for its input is indistinguishable from a gate that denies everyone.
  - **Why 12 days of green tests.** `mockRecord` carried neither `created_by` nor `inspection_required`, so both guards resolved to `undefined` and never armed; Test 9 additionally sent `inspection_required: false`, a field the real UI never sends. The suite asserted against a session shape and a payload production does not produce. → [[Tests Can Encode Bugs]]
  - **Fix:** migration **113** adds `vehiclemaintenance.repair_completed_by` (FK → `employees`, stamped server-side on the move into `Pending Inspection`) and the four-eyes guard compares *that*; `NULL` never blocks, and no backfill was done. `created_by` is deliberately not a fallback. The inspection gate and its three dead allowlist entries are deleted; `Pending Inspection` was added to both status dropdowns and the badge tone map (the route understood a state no UI could reach); the in-progress counter now includes it. → [[Maintenance]]
  - **Verified:** tests 11–14 added, then **proven to have teeth** by reverting the route to its pre-fix revision — all four fail with the correct message — before restoring it. Full suite **141 files / 1338 tests pass**, ESLint clean on 7 files, clean `schema.sql` diff, migration confirmed via `information_schema` + `pg_constraint`, and the app's three real queries replayed against live. Also note: this is the **second** time inspection columns were tried on `vehiclemaintenance` (005 merged the table in, `018b` dropped it again).

## Fixed — 2026-09-19

- **Mobile showed `Network request failed. Check your connection.` on local Wi-Fi.** The ignored `mobile/.env` still pointed at a retired LAN address, while the Next API was listening on the machine's current address at port 3000. The stale address timed out; the corrected address returned the API's expected HTTP 400 for an empty login body. No API or auth code was changed. Physical builds must be reloaded/rebuilt after changing `EXPO_PUBLIC_API_URL` because Expo inlines public variables into the bundle.
- **Devices & Sessions treated session rows as devices and used “Sign Out” wording.** Same-IP rows were easy to misread as duplicate devices even though web session IDs and mobile refresh families are the real identities, and the mobile current-session branch called the nonexistent `clearAuth` helper. The screens now say “active sessions,” explain shared-IP behavior, revoke by `kind:id`, and use the existing `signOut` cleanup only after the server has revoked the current mobile family. The sessions API responses and web/mobile confirmations now use “Revoke session.” No migration was needed; touched-source lint is the verification gate.
- **The dispatcher's chosen pair was dropped on every navigation — the chat kept asserting a choice the panel no longer held.** Reported as *"when the dispatcher has already chosen and moves to another tab, the chosen option is not saved — only the chat is."* `DispatchPlanPanel` keys the Copilot panel on the reservation (`key={selectedRequest?.request_id}`, `dispatch-plan-panel.jsx:38`/`:93`), so leaving the route and returning **remounts** the whole subtree and `useState(null)` won. Only the transcript was persisted (sessionStorage), and the queue plan and recommendation already live in the app-level QueryClient — the chosen pair was the one piece of the state held in React. Consequence was worse than a re-click: the transcript still showed the picked option, so the screen contradicted itself. **Fix:** the selection is stored beside the transcript in the same module (`copilot-conversation.jsx`, `fleetops_dispatch_copilot_selection_map`, same 30-entry prune and private-mode guards), recording the pair key **and the pinned option key list**, so the restored card keeps its number when the engine re-ranks; it is cleared by *Change selection*, by a successful assignment, and by `clearReservationMessages`/`clearAllReservationMessages`. Restoring **appends no chat turn** — `CopilotConversation` re-anchors the inline review to the persisted `select-pair` message matching the selection — and the check is re-run on return (the accepted cost: one queue re-analysis per remount), guarded by a ref because that re-analysis invalidates the recommendation query and would otherwise re-run in a loop. The transcript is deliberately **not** the source of truth: `chooseAnother` clears the selection without appending a message, so deriving from the last `select-pair` turn would resurrect an abandoned choice. Verified: `src/components/reservations` **67/67 in 8 files** (10 new tests: 4 for the pure resolution step in the new `copilot-options.test.js`, 4 store tests including a `vi.resetModules()` round trip through a stubbed sessionStorage, 2 handler tests for persist/clear), ESLint clean on all seven touched files. **Teeth proofs executed** — ignoring the remembered pin fails exactly 3 assertions, and removing the persist, the clear-on-change, or the selection clear from `clearReservationMessages` each fails exactly its own test — with every file restored byte-identical afterwards. Honest limit: the restore is an **effect**, and no test here can run effects (all component tests use `renderToStaticMarkup`; a DOM harness would need a browser-testing dependency), so the restore decision was extracted into the pure `resolveRememberedOption` to be provable at all, and **browser acceptance of the restored review remains pending**. No schema change, no migration, no new dependency, no commit.

## Fixed — 2026-09-06

- **APK login failed "Network request failed. Check your connection." after exactly ~15s on field WiFi.** `mobile/lib/api.js` capped every request at `TIMEOUT_MS = 15000` and excluded auth paths from retry entirely, but a successful login is bcrypt plus several sequential DB round-trips behind a serverless function — ~4s warm, 10s+ cold — and Android can burn ~10s more trying a dead IPv6 route before falling back (Chrome hides this via Happy Eyeballs; the RN fetch stack does not, which is why the phone browser worked while the app timed out). Fix: timeout raised to 30s and login now gets the single retry like every other request (max 2 rate-limit hits per tap, under the 5/min cap). Requires an APK rebuild to take effect — verified-good rebuild flow: `cd mobile && npx eas-cli build -p android --profile production`, uninstall the old app, install the new `.apk`.
- **Vercel logs buried real 500s under routine 403 stack traces (`handleError` logged every `AuthError` with a full stack).** Drivers on the web fire `/api/auth/heartbeat` every 5 min by design (the route restricts to dashboard roles, and the session-manager client ignores non-OK responses), so each poll printed `API error: Error: Role 'driver' is not permitted` **plus stack trace** — during the 2026-09-06 APK 500 investigation this noise made the actual fault hard to spot in pasted logs. The 403 itself is correct behavior: driver web sessions keep their `last_seen_at` fresh via `resolveCurrentIdentity`'s throttled 5-min UPDATE on any authenticated API call (src/lib/api/utils.js), so no session is harmed — the heartbeat restriction only excludes drivers from the client-side countdown modal. Fix: `handleError` now logs `AuthError`s as one concise `console.warn` line (`API rejected [403 SESSION_INVALID]: …`) and reserves `console.error` + stack for unexpected errors. Response payloads unchanged. Verified 2026-09-06: `utils.test.js` (5) + `idle-session.test.js` (6) + `security-boundaries.test.js` (9) — **20/20 pass**, and the new one-line format is visible in the test stderr output.
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

## Fixed — 2026-09-19 — RS-W3JU showed zero options (duty-window false positive + stale dispatches)

**Symptom:** Dispatch Copilot on `#RS-W3JU` (request 505, NAIA T2 → CoCo Star, Sept 20 8PM Manila) showed
"No eligible assignment is currently available" with only an insurance exclusion for XYZ 5678 — even though
ABC-1234 + driver Karlo Torres were free with valid documents.

**Two layered causes, fixed both:**

1. **Stale dispatches (data).** #596 (Sept 16) and #597 (Sept 17) for vehicle 37 / driver 19 were still
   `Scheduled` with `Assigned` trips that never started. Stood both down through `setDispatchStatus →
   Cancelled` (proper transition: trips + requests RS-H072/RS-G2PA cancelled, audit written, mock gateway
   acked). Verified live: dispatches/trips/requests all `Cancelled`, engine then recommends v37+d19 SAFE.
2. **Multi-day duty-window false positive (code).** With a non-completed preceding dispatch on file,
   `evaluateDispatchCandidate` (`src/services/dispatch-radar.service.js`) checked the span
   [release → trip end] — Sat 9AM → Sun 8PM — against a SINGLE day's shift/break, so Saturday's 12–1PM
   lunch break blocked a Sunday 8PM trip that fits its own day. The trip-day [pickup → arrival] check in
   `detectRequestConflicts` already covers the real requirement (Dispatch.md "Availability is decided by
   the window"). Fix: the release-to-end re-check now runs only when release and trip end fall on the same
   calendar day (`toCalendarDay`).

| Bug | Was | Verified by |
|---|---|---|
| Duty re-check spanned calendar days | Multi-day [now → end] span checked against one day's break → healthy drivers withheld whenever any preceding dispatch existed | 2 new tests in `dispatch-radar.test.js` (multi-day skipped, same-day still blocked); 16/16 file, 42/42 related suites pass; live engine re-run recommends v37 |

**Lesson:** the exclusion panel told the truth both times — the first read stopped at the insurance line and
missed that the second vehicle's reason was the actual defect. Read all `none_reasons`, not just the first.

**Follow-up 2026-09-19:** v1 insurance renewed in the DB (`2026-08-24` → `2027-08-23`, annual renewal same
month/day — correct it if the policy says otherwise). Live engine re-run: **both pairs SAFE, zero exclusions** —
recommended v1+Jack Mors, alternate v37+Karlo Torres.

## Open — 2026-09-19 — three of the ten evidence proofs return 404 (leave, pairing, comparison) — ROOT-CAUSED, NOT FIXED

**Symptom:** the Evidence Drawer's Review action on a *leave*, a *pairing* or a *comparison* row returns
"Evidence is currently unavailable." (HTTP 404). The other seven proof types resolve normally. Deferred by
explicit instruction — *"address the leave/pairing/comparison proof 404s separately"* — so this entry records the
diagnosis, not a remediation. **No production file was changed for it.**

**Two independent defects, not one.** All three failures land on the same user-visible string because
`evidence/route.js:51` catches everything and re-throws a single `AuthError('Evidence is currently unavailable.', 404)`
— so the surface is uniform and the causes are not:

1. **A column that does not exist, twice** (`src/services/evidence-resolve.service.js`). `resolveLeave()` (:49-67)
   filters `driver_leave_requests` on `status='Approved' AND deleted_at IS NULL`, and `resolvePairing()` (:144-163)
   filters `substitute_vehicle_schedules` on `deleted_at IS NULL`. **Neither table has a `deleted_at` column.**
   Postgres raises `42703 undefined_column`; `db.query` is the only throw site in each resolver, so the throw is
   indistinguishable from a genuine outage by the time the route sees it. Read-only live census of both tables
   confirms the absence: `driver_leave_requests` = leave_request_id, driver_id, start_date, end_date, leave_type,
   reason, status, requested_at, reviewed_by, reviewed_at, review_notes, start_time, end_time;
   `substitute_vehicle_schedules` = substitute_id, vehicle_id, substitute_driver_id, effective_from,
   effective_until, notes, created_at, updated_at, created_by, updated_by. `evidence-resolve.service.js` is the
   **only** file in the repository that references `deleted_at` on either table.
2. **An arity mismatch that makes `ctx` undefined** (same file). `resolveComparison(db, refData, ctx, deps)` reads
   `ctx.requestRow` (:197-206), but `resolveEvidence()` (:236-250) calls `resolver(store, { ...refData, ...ctx },
   ...)` — **two arguments**, so `ctx` is `undefined` and the property read throws. This is the comparison proof
   only, and it is a different bug from the two above: nothing is wrong with the SQL there.

**Why the suite was blind to both, which is the more useful finding.** Four independent reasons, each of which
would have to be closed separately: `evidence-resolve.test.js` drives the resolvers through a fake
`dbFor = handlers => ({ query: async (sql, params) => ({ rows: await handlers(sql, params) }) })` whose handlers
branch on `sql.includes('FROM vehiclemaintenance')` — **they never parse the SQL**, so a column that does not exist
is invisible by construction; `resolveComparison` is only ever called *directly with an explicit `ctx`*
(`evidence-resolve.test.js:68`, `fleetmate-evidence.test.js:243`) and no test anywhere calls `resolveEvidence` with
`proofType: 'COMPARISON'`, so the production call shape is never exercised; `evidence/route.test.js:5` mocks
`resolveEvidence` wholesale, so the route test cannot see inside it either. And the schema gates do not cover the
class at all — `scripts/lib/sql-references.mjs` extracts **table** names only (`NOT_A_TABLE`,
`referencedTablesInFile`), so `npm run db:contract` reports this file clean while a column in it does not exist.
**Table-level contract passing is not column-level correctness**; that is the gap this defect fell through, and it
is worth noting that the same gap would hide any future wrong-column bug in any raw-SQL service.

**Fixes identified, not applied** (deferred by instruction): drop `AND deleted_at IS NULL` at both sites — these
tables have no soft-delete, their lifecycle is `status` / the effective date range — and give `resolveComparison`
its context (`ctx?.requestRow ?? refData.requestRow`, or pass `ctx` through from `resolveEvidence`). Each deserves
its own regression test that pins the *production* call shape, since the existing tests pass against the broken
code and would go on passing after a fix that only satisfied them.

**Sweep 2026-09-19 (same class of problem, other bookings):** full suite **1931/1931 pass**; live-data sweep
found 0 stale `Scheduled` dispatches left and only 1 open request in 7 days (RS-W3JU, fixed). One latent gap
flagged, not fixed: **v18 ABC 1454** (only VIP cat-1 vehicle) has expired insurance (2026-08-09) AND its
custodian driver 4 is `Suspended` with no schedule rows — a VIP booking today would show zero options the same
way. The other 12 schedule-less custodians are `TST-/TSG-` seed vehicles, not operational.

## Fixed — 2026-09-19 — FleetMate narration, queue precedence, and session state

The non-email defects found during the uncommitted-worktree audit are closed.

- FleetMate's deterministic summary now preserves the safety contract for blocked
  and unverified pairs, gives a truthful explanation for a single ready option,
  and includes material downstream dispatch reasons instead of only the first
  pair reason.
- Queue confirmation now reports stale or failed recommendation evidence before
  queue validation status, so a loading message cannot hide an unavailable
  result.
- Copilot conversations, selections, and baseline snapshots are cleared during
  sign-in-again and identity replacement; optimistic session activity refs are
  reset at the same boundary.
- Generated Expo output under `mobile/.expo/**` is excluded from source lint,
  and the related documentation/EOF hygiene issues are corrected.

Verified:

- `npm run test:run` — **179 files / 2,043 tests passed**.
- `npm run lint:ci` passed.
- `npm run build` passed with **204/204** static pages generated.

## Fixed - 2026-09-20 - Map own-vehicle marker missing on Android cold start

The Map screen could remain without the driver's own car marker when Android delayed or rejected the first highest-accuracy `getCurrentPositionAsync()` call. The screen now uses an 8-second bounded fresh-fix request, a recent `getLastKnownPositionAsync()` fallback, and then the existing live position watcher. The fallback is local-only and does not synthesize fleet/radar data.

Verification: Map ESLint clean; focused coach-mark and Map-intro tests 56/56; Android export bundled 1,387 modules; final EAS preview build `2dea7830-a960-4fd4-8e5c-4f11168ce7dd` finished successfully. Final APK: https://expo.dev/artifacts/eas/9CcUWryae0tYqy6s0SgRvNDB5QCI2liNFy_HZp5PjvY.apk

## Source hardening — 2026-09-21 — downloaded APK still lacked Map tooltip and car

The user-reported APK result exposed three independent release-path gaps that were not visible in source-only checks:

- the first Map target tree was behind the GPS spinner, so the provider had no measurable target for the spotlight;
- Reset In-App Tips could immediately show Home's Welcome overlay, which blocked or rejected the intentional Map-tab trigger;
- the Android TomTom WebView could fail to resolve the local `carlive.png` URI after the own-vehicle marker was created.

Source fixes: Map renders its stable tutorial shell while `map_intro` is pending/active but keeps the ordinary loader for normal visits; the reset-triggered Welcome scrim is pass-through for navigation and an intentional Map tap may hand off only from that Welcome card; the fresh GPS result is validated before the cached fallback; and the car marker keeps the bundled PNG with the original small radar-dot fallback when the asset is unavailable. No fake release radar data, second watcher, polling loop, API request, dependency, or non-Map tooltip change was added.

Verified: focused coach-mark/Map-intro tests **60/60** and touched-file ESLint passed. The prior APK is not considered a verification of this source correction. No EAS rebuild was run after it because rebuilding is explicitly waiting for the user's instruction; device acceptance remains pending.

## Source simplification — 2026-09-21 — Map tutorial eligibility

The first Map tutorial no longer depends on location permission, a GPS fix, or
motion state. Its only eligibility check is an intentional Map-tab tap while
the current driver's `map_intro` completion key is absent. GPS remains the
separate prerequisite for the own-vehicle marker/live tracking path. Focused
coach-mark/Map-intro tests pass **60/60** and no rebuild was run.
