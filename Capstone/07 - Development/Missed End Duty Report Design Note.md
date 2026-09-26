---
type: plan
status: implemented
title: Missed End Duty Report
tags: [development, mobile, attendance, duty, design]
source:
  - mobile/lib/end-duty.js
  - mobile/lib/missed-report.js
  - mobile/lib/use-duty.js
  - mobile/app/(app)/end-duty.js
  - mobile/app/(app)/(tabs)/index.js
  - src/app/api/mobile/driver/duty/route.js
  - src/services/standby.service.js
  - src/services/dispatch-evidence.service.js
  - src/app/api/driver/me/route.js
  - supabase/migrations/121_end_duty_maintenance_source.sql
  - supabase/migrations/125_end_duty_outcome.sql
  - supabase/migrations/126_duty_autoclose.sql
  - supabase/migrations/129_end_duty_submission_id.sql
  - supabase/migrations/131_vehicleinspection_problem_queue_index.sql
  - supabase/migrations/099_pg_cron_sla.sql
  - src/lib/inspections/problem-queue.js
  - src/app/api/vehicle-inspections/problems/route.js
  - src/app/api/vehicle-inspections/[inspectionId]/work-order/route.js
  - "src/app/(dashboard)/maintenance/problems/page.js"
  - src/lib/scheduling/end-duty-thresholds.js
  - src/services/end-duty-reminder.service.js
  - src/lib/notifications/copy.js
  - src/app/api/cron/sync/route.js
  - .github/workflows/cron-sync.yml
  - mobile/lib/notifications/navigation.js
  - src/lib/notifications/target.js
last_verified: 2026-09-26
---

# Missed End Duty Report

**Status: implemented (2026-09-25).** Part A built two complementary safety nets. Net 1 is a driver-facing Home card for the most recent past duty that still owes a report; its CTA opens `/end-duty?reportFor=<date>` so the service can file the report against that day's vehicle when one exists. Net 2 is the database backstop: migration `125_end_duty_outcome.sql` added the nullable `driverattendance.end_duty_outcome` vocabulary (`Reported`, `NoVehicle`, `AutoClosed`), and migration `126_duty_autoclose.sql` added `public.auto_close_unreported_duties(p_now timestamptz DEFAULT NOW())` plus the hourly `duty-autoclose-sweep` job.

The date-aware close and late-report amend are implemented. Migrations `121_end_duty_maintenance_source.sql` and `129_end_duty_submission_id.sql` preserve End Duty maintenance provenance and no-vehicle submission idempotency. An auto-closed row keeps the sweep's `time_out = NOW()` and gains the exact remark `Auto-closed 04:00: no End Duty report submitted`; its duration is therefore system-derived, not a driver's reported out-time. A later report changes the outcome to `Reported`, preserves that close time, and appends the late-report fact. The result screen answers `noVehicle` before `late`, so `{recorded:false, late:true}` cannot claim that a report was filed.

**Status of the three parts:** Part A is **implemented** (2026-09-25). Part B — the office worklist — is **code complete 2026-09-26**, with its browser-verification steps not performed (they need an authenticated admin/fleet_manager/dispatcher session, and the raise would push a real notification). Part C (the phone reminder) is **code complete 2026-09-26**, with its device-verification steps not performed (they need a real device build — Expo Go cannot receive remote pushes — plus a manual Actions run). The plan had this note at `planned` for all three before any task ran; it was set to `implemented` when Part A landed and is not being downgraded. Net 3, the office exception surface for auto-closed duties, is **separate from Part B** and is still not built — Part B is the vehicle-problem worklist, not an unreported-duty list.

### Part B — the three buckets

The manager-facing worklist at `/maintenance/problems`. The distinction that matters is which bucket the dashboard counts:

| Bucket | Predicate | Meaning | Counted? |
|---|---|---|---|
| `reported_untracked` | `inspection_type='Post-Shift' AND status='Reported' AND` no work order | The driver reported a defect and no repair ticket exists — the `raiseEndDutyWorkOrder` failure path, best-effort and currently silent to the office | **Yes** |
| `failed_untracked` | `status='Failed' AND` no work order | A failed Pre-Shift / Pre-Trip. Shown and closable, but the office may legitimately decide no repair is warranted | No |
| `tracked` | a work order exists | Resolved, shown with its ticket status | No |

Resolution is the existence of a `vehiclemaintenance.source_inspection_id` link, not a flag. Only an End Duty report raises a work order automatically; the office raises one by hand for any flagged inspection, and that hand raise files as `Scheduled` dated tomorrow — so it never removes a vehicle from dispatch and grounding stays the office's call.

Verification recorded in the SDD ledger for Part B: lint exit 0, repo-wide **212 files / 2611 tests**. **No device or browser verification exists for either part.**

Verification recorded in the SDD ledger for Part A is lint exit 0, repo-wide 209 files / 2565 tests, and 126 coach-mark tests. No device verification exists for Part A.

A driver who never submits the End Duty report now leaves an open row only until the backstop reaches it: `time_in` is set, `time_out` is NULL, and the row has no outcome. The system closes eligible past rows after the 04:00 Asia/Manila gate; Net 1 gives the driver a date-anchored way to add the report before or after that close.

### Part C — the two-stage reminder (code complete 2026-09-26)

The phone is now told, not just the app. `syncEndDutyReminders()`
(`src/services/end-duty-reminder.service.js`) scans open duties and climbs a
**two-stage ladder**, the mirror of the start-window producer:

| Boundary | Title | in-app | push | Sound |
|---|---|---|---|---|
| shift end **+ 30 min** | `End Duty Reminder` | `Warning` | `heads-up` | silent |
| shift end **+ 2 h** | `End Duty Still Not Reported` | `Alert` | `default` | loud |

Only the **most advanced** crossed stage fires per run. The grace deliberately
starts *after* the shift ends, while `mobile/lib/end-duty.js` opens the Home
nudge *before* it — a driver still driving home has not forgotten anything.

**Decided — the dedupe key.** Titles are stable event names and the title *is*
the dedupe key, so the date had to live somewhere. It lives in
`reference_id = YYYYMMDD` (`dutyDayKey`), under
`pg_advisory_xact_lock(hashtext('end_duty_reminder_' || attendance_id))` with
check-then-insert. **A constant in `reference_id` would notify each driver once
ever and then silently swallow every later night** — it passes on day one and
only fails on day two, which is why two tests pin the rollover rather than one.

**Decided — one preference key for both stages.** Both stages share
`NOTIFICATION_EVENTS.end_duty_reminder`, because the mobile Push toggle is a
master switch over the channel; a driver cannot silence stage 2 while keeping
stage 1. The asymmetry is the safe direction: stage 2 only fires once the report
is hours late and the automatic close is next.

**Decided — the roster out-time is read, never re-derived.** The producer takes
`duty.end` from `loadDriverScheduleContext` + `driverDayEligibility`, the same
pair the duty endpoint answers from, so the reminder and the `setDuty` gate can
never hold two different clocks. Rest day / approved leave / no roster row land
in `end_duty_skipped`, not `errors`.

**The scheduler gap is now closed (Part C's real deliverable).** `/api/cron/sync`
runs nothing on its own — it is an endpoint, not a scheduler — and no caller was
configured, so `cron_sync_last_ok` had been stale since **2026-09-06**. Every
time-driven producer was correct code that never executed, the start-window
producer among them. `.github/workflows/cron-sync.yml` is that caller now (and
its `*/5 * * * *` schedule with a 5×60s in-job loop is what unblocks the
start-window producer as well). It is **not yet firing** as of 2026-09-26: it
still needs a merge to `main`, the `APP_BASE_URL` / `CRON_SECRET` repository
secrets, and `CRON_SECRET` in the deployment environment. Honest limits: GitHub
schedules are queued rather than punctual, run only on the default branch, and
are disabled after 60 days without repository activity.

Verification recorded in the SDD ledger for Part C: lint exit 0, repo-wide
**217 files / 2657 tests**; `end-duty-thresholds.test.js` 15/15,
`end-duty-reminder.service.test.js` 13/13, `cron/sync/route.test.js` 7/7, the
two deep-link suites 5/5 — each red-green. **No device verification exists for
Part C**: plan acceptance criteria 1–3 and 6 need a real device build and
criterion 10 needs a manual Actions run.

## The original gap and the implemented behavior

Established by reading, not inference. Every claim below has a `file:line`.

### The driver is never stranded same-day

The nudge window **never closes** — it opens 30 minutes before the rostered out-time and stays open:

> A driver who is still checked in past their out-time still owes the report; a window that closed itself at the stroke of the hour would hide the report from exactly the driver who is running late
> — `mobile/lib/end-duty.js:3-7`

The card is gated on `due = loaded && checkedIn && !busy && window.due` (`mobile/lib/use-duty.js:89`), so past the out-time it stays available right up to midnight. A late finisher can always close out.

And there is no bypass: `POST active: false` requires a report **and** a `client_submission_id` (`src/app/api/mobile/driver/duty/route.js:216-231, 313` — the id is checked in the route and the report passed into `endDutyWithReport`, which rejects a reportless close with 400 at `src/services/standby.service.js:101-102`), because the report and the `time_out` are one transaction (`src/services/standby.service.js:100-105`). Duty does not end until the driver answers.

### Midnight is the hand-off

`checked_in` is scoped to today:

```sql
AND a.date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND a.time_in <= NOW() AND a.time_out IS NULL
```
— `src/services/standby.service.js:14-16`

At midnight it flips false and the same-day card disappears, while yesterday's row remains eligible for the late-report lookup. Net 1 surfaces that row on Home; Net 2 closes it at or after the 04:00 Manila gate if the driver never returns.

### The backstop closes the row

The original observation — **no attendance or duty sweep, no trigger, no worker** — was accurate when written. Migration 126 now schedules `duty-autoclose-sweep` hourly (`0 * * * *`) and gates the function on the local Manila hour **inside the function**, not in the cron expression. Before 04:00 Manila it returns without closing a row; from 04:00 onward it closes eligible past rows only when `time_out` and `end_duty_outcome` are both NULL.

The sweep sets `time_out = NOW()`, sets `end_duty_outcome = 'AutoClosed'`, and appends `Auto-closed 04:00: no End Duty report submitted`. Its `REVOKE ALL ON FUNCTION ... (timestamptz) FROM PUBLIC, anon, authenticated` is load-bearing: without the typed revoke, PostgREST's anon RPC path could invoke the public function.

### The late-report repair path

`endDutyWithReport` resolves the duty day from the open row or the explicit `report_date`, and `resolveReportVehicle` uses that same date rather than today's vehicle. A late report can amend an `AutoClosed` row: the service keeps the sweep's `time_out`, changes `end_duty_outcome` to `Reported`, and appends the late-report remark. When no vehicle can be resolved, it closes the day with `NoVehicle` and no invented inspection. Migration 129 gives that no-vehicle close a stable submission id so retries do not create another close.

### What the office still sees: no exception surface

`driverattendance` is read by the driver's own history page (`src/app/api/driver/me/route.js:93`) and fed to the AI dispatch advisor as evidence (`src/services/dispatch-evidence.service.js:19`).

There **is** an attendance page in the web dashboard — `src/app/(dashboard)/driver/attendance/page.js` — but it is **self-scoped**: it calls `getMyDriverProfile()` and renders "My Attendance" under a *Driver Workspace* badge, read-only, with no actions. It cannot show a list of other drivers. The office's `drivers/` route group is driver management and carries no attendance.

So no office page shows **which driver has an auto-closed or otherwise unreported duty**. Every current read of attendance is either self-scoped or machine-facing. This is Net 3, which is intentionally not part of Part A.

The remaining residue is: office users still lack an exception list, while the driver-facing Home card and the database backstop handle the record itself.

### What is *not* broken

Checked, and worth recording so nobody re-opens these:

| Concern | Finding |
|---|---|
| Does it block tomorrow? | **No.** `setDuty`'s insert conflicts on `(driver_id, date)` (`standby.service.js:66-70`) — a new day is a new row. Clean start. |
| Is `driver_status` a stuck "on duty" flag? | **No.** Nothing ever writes `'Off Duty'` — not on a *normal* close either. The only writers set `Available` (`standby.service.js:71`, `status.service.js:335`, `drivers/[id]/route.js:295-300`) or whatever a human picks (`:205`). It is not a duty signal. |
| Does `duty_started_at` leak the stale row? | **No.** It is *not* date-scoped (`standby.service.js:14`), but both uses sit behind a `checked_in` guard (`:364`, `:388`), and while checked in today's row is the `max(time_in)`. Resolves correctly. |

## Why the same-day path is not enough

The window already extends to midnight, so "ran late" is covered. The uncovered case is precisely *went home and forgot*. That is the case this design addresses.

## The design: two safety nets

They are **complementary, not alternatives.** The Home card is the normal recovery path; the sweep is the backstop for a driver who never returns (leave, illness, resignation).

### Net 1 — Home late-report card (primary)

`GET /api/mobile/driver/duty` returns the most recent eligible past day within the server's lookback when it still owes a report. `useDuty().unreported` forwards that top-level field, and Home renders the card using `mobile/lib/missed-report.js`.

- **Copy shape:** the card names the date and vehicle, explains that the shift was closed without a report, and offers **File that report**.
- **CTA:** `/end-duty?reportFor=<date>`, anchored to the stale row's date and vehicle.
- **Never blocks the Pre-Shift.** Today's safety check outranks yesterday's form. A hard gate here means a driver standing at the vehicle cannot work because of a report screen — a worse failure than the paperwork gap it fixes.
- **One current item:** the API offers the most recent owed day, so Home does not stack several report cards.
- **No prompt for `NoVehicle`:** the server excludes a day that ended without a vehicle pairing, because there is no vehicle report to file.

### Net 2 — hourly auto-close (backstop)

A `pg_cron` job closes any eligible attendance row still open after the chosen grace period. The precedent exists — `099_pg_cron_sla.sql` already schedules a sweep.

- **Grace:** the function's local-day gate is 04:00 Asia/Manila. The cron expression is hourly so the function, not the scheduler timezone, owns that business rule.
- **The note is unmistakable:** `remarks = COALESCE(remarks || ' | ', '') || 'Auto-closed 04:00: no End Duty report submitted'`.
- **System-derived duration:** `time_out` is the sweep's real `NOW()`, not an inferred driver out-time. A later report preserves that timestamp and appends the late-report fact.
- **Honesty remains load-bearing:** the outcome column distinguishes `AutoClosed` from `Reported` and `NoVehicle`; the sweep does not pretend it observed a normal driver clock-out.

## Where the vehicle comes from — the hard part

This is the requirement most likely to be got wrong, and getting it wrong is a downgrade.

Resolving the vehicle from **today's** inspections instead of the duty's own day would attach a Post-Shift inspection to **today's** vehicle while describing **yesterday's** shift — a wrong-vehicle maintenance record. The plan called date-aware resolution the load-bearing change (`docs/superpowers/plans/2026-09-24-missed-end-duty-and-problem-queue.md:981`), and the route's own doc comment records the same hazard (`src/app/api/mobile/driver/duty/route.js:18-21`).

Part A implements the required safeguards:

1. `resolveReportVehicle` is **date-aware**, resolving from the stale row's date.
2. `endDutyWithReport`'s close-out uses the resolved duty date, so it closes the intended row and only that row.
3. When the vehicle **cannot** be resolved (no dated inspection or eligible pairing), the report still closes the row with `NoVehicle` rather than guessing.

The late-report path also distinguishes a client-named date conflict from a retry, and the stable submission id prevents a retry from becoming a second report.

## What the record must say

Both truths, never one:

> `Auto-closed 04:00: no End Duty report submitted | Late End Duty report received 2026-09-25 08:15`

If the driver reports, the record changes to `Reported` but does not erase the auto-close remark or timestamp. If they never do, the `AutoClosed` note stands. Either way the row is closed *and* honest about how.

## Decisions now set

1. **Grace period:** the sweep gates at 04:00 in Asia/Manila, inside the function. A late report before that boundary is not late; a later report can amend an `AutoClosed` row.
2. **Office exception surface:** not built in Part A. Net 3 remains a later task.
3. **Late report:** it amends the auto-closed attendance row and keeps one row per day; it does not replace the row or erase the auto-close evidence.

## Alternatives considered

| Option | Verdict |
|---|---|
| **Plain auto-close, no prompt** | Cheapest. Cleans the record but loses the information — the fleet never learns whether anything was wrong with the vehicle. |
| **Driver carry-over only** | Honest (no fabrication) but needs the same date-aware vehicle work as Net 1 *and* leaves non-returners open forever. |
| **Office exception list only** | Best accountability, biggest build, and does nothing for a driver who would have answered. |
| **Accept and document** | Zero machinery. The broken rows accumulate and keep feeding the dispatch advisor. |

## Cost

- **Net 2 (backstop):** a `pg_cron` job and a remark. Small — the scheduling pattern already exists.
- **Net 1 (prompt):** a mobile surface, an API path, and the date-aware vehicle resolution above. Materially larger, and the part that carries the correctness risk.

## Related

- [[Driver In-App Guide]] — §3.1d documents the End Duty card and its window.
- [[Tracking]] — the standby GPS paths gated on `checked_in`.
- [[Technical Debt]]
