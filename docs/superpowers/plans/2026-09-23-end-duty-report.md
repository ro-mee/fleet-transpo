# FleetOps End Duty — post-shift vehicle report wired into the existing duty session

**Goal:** Make Pre-Shift the **Start Duty** indication and add an **End Duty** report that
closes the shift — one question ("did you notice anything unusual about the vehicle?") asked
near out-time, with a reported fault raising a maintenance work order.

**Architecture:** No new duty machinery. Start/End Duty already existed
(`setDuty` → `driverattendance` + `drivers.standby_tracking_enabled`, driven from the Profile
button). The report is a third `vehicleinspection` type (`Post-Shift`, no checklist) written
**inside the same transaction** that closes `time_out`, so duty cannot end without a report and
a report cannot exist against an open shift. Grounding rides the maintenance register rather
than `vehicle_status`.

**Tech Stack:** Next.js 16 route handlers, `pg` via `@/lib/db`, Expo Router mobile app, Vitest,
ESLint.

## Decisions (owner's answers, 2026-09-23)

| Question | Answer |
|---|---|
| What does the report ask? | **One question + free text.** No item checklist. |
| What happens to a report? | **Record + maintenance work order** (mirrors the incident path). |
| When is it offered? | **30 min before shift end**, and only while `checked_in && !busy`. |
| Can it be skipped? | **No — the report is required to end duty.** |
| Does it ground the vehicle? | **Ground on severe keywords.** |
| Relation to the End duty button? | **Submitting the report is what ends duty.** |
| Does Start Duty require the baseline? | **Yes** — a third gate on `setDuty(true)`. |
| When is the Pre-Shift prompt hidden? | **Never on a rest day or approved leave.** |

## Where the trigger came from, and why the first draft was wrong

The original design read a 30-minute clock against the **roster**, which knows nothing about
whether the driver is actually on duty. It would have prompted a driver **mid-trip** (ignoring
`standbyState.busy`, which exists precisely to mark a live trip or an open incident) and a driver
**who never checked in** (roster hours apply regardless). Corrected to
`checked_in && !busy` plus the **server's own** `today.duty.end` — so the nudge and the
`setDuty` gate are one computation rather than two that can drift.

## Deviations and corrections to the plan

1. **`Post-Shift` is rejected on the inspections POST.** The plan had `POST
   /api/mobile/driver/inspections` accept the type. It does not: the report must be atomic with
   `time_out`, and that route has no transaction to join. `GET` still accepts it as a
   `?inspection_type=` filter so the app can ask whether today's report exists. Net effect is the
   intended one — **exactly one way to write a report** — reached by refusing rather than by
   routing.
2. **`isChecklistType(type)` was added** to `src/lib/inspections/checklists.js` rather than
   inlining a two-way comparison at the call site, so the "which types carry items" question has
   one answer the GET allowlist and the POST rejection both read.
3. **No `maintenance_error` column.** The plan's Task 8 branch would have recorded a maintenance
   failure on the inspection row. Dropped: `raiseEndDutyWorkOrder` never throws and logs via
   `writeAppError` (work-order and notification failures separately), and an unlinked inspection
   row already shows as a gap in the register's provenance chip. A column nothing reads is worse
   than a log line that already lands in the app-errors table.
4. **`ApiError` gained a third constructor parameter (`code`).** The plan assumed screens could
   act on `PRESHIFT_REQUIRED`; the client's error type carried only `status`, so the code was
   being discarded. Additive and defaulted to `null`, so no existing call site changes.
5. **The Pre-Shift banner is gated on `today.blocked === false`, not on a cached roster.** The
   plan's Task 9 had the client hold `resolveTodayShift(days, now)` and a cached roster read.
   Deleted: `driverDayEligibility` already answers the question server-side (leave windows,
   rest day, missing schedule row) and `setDuty` enforces it, so a client copy would have been a
   second, weaker implementation of the same rules. `GET /api/mobile/driver/duty` returns the
   verdict instead.
6. **`end-duty.js` does not display a resolved vehicle.** The server resolves which vehicle the
   report belongs to inside the transaction; re-deriving it on the client would be a second
   answer to a question the server owns, and a wrong plate on that screen is worse than no plate.
7. **The nudge window stays open after the shift end** rather than closing at the stroke of the
   hour. A driver still checked in past their out-time still owes a report, and a closed window
   would hide the only route that ends duty.
8. **`use-duty.js` initialises its fallback clock in a lazy `useState`, not during render.**
   `Date.now()` in a render body trips `react-hooks/purity`; the initializer is the sanctioned
   place for a non-deterministic value, and it advances on each focus refresh.
9. **A correction to my own risk assessment, recorded because the plan stated the opposite:** I
   had warned that "report required to end duty" risks trapping an offline driver. It does not —
   `profile.js` already passed `queueOnFailure: false`, so duty toggling was **already**
   online-only, and the requirement adds no new offline failure mode. The end-duty screen keeps
   that flag and, unlike the generic offline copy, says the shift is still open rather than
   claiming a queued request will sync.

## Residual, recorded rather than fixed

- **A `Failed` Pre-Shift baseline does not block Start Duty.** The gate is the row's
  **existence**, matching "indication". Whether a failed baseline should block — and whether it
  should ground the vehicle through the same escalation — is an open policy fork.
- **Overnight shifts are not expressible.** The roster stores a pair of `TIME` columns with no
  day-crossing flag, so a 22:00–06:00 span resolves its end to *this morning*. The nudge and
  `setDuty` are both wrong about that shift in the same direction; a fix belongs on
  `driver_work_schedules`, not in the client.
- Keyword matching over free text is brittle — a fault described in unexpected words files a
  `Scheduled` order and waits for a human.
- **Device verification is still pending**, and it is the only place these can be confirmed:
  the window appearing and not appearing (mid-trip, after an incident, before check-in), a rest
  day and an approved-leave day both showing no Pre-Shift banner, a refused end-duty without a
  report, the routing from `PRESHIFT_REQUIRED`, a keyword report grounding the vehicle, and the
  maintenance notification appearing once rather than once per retry.
