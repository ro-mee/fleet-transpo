---
type: plan
status: implemented
tags: [plan, notifications, scheduling, driver, cron]
created: 2026-09-09
implemented: 2026-09-09
target: time-aware trip start notifications
related: ["[[Notifications]]", "[[Trips]]", "[[Dispatch]]"]
---

# Plan: Trip Start-Window Notifications

## Current behavior update - 2026-10-03

The original Driver-Accepted-only scan described below has been superseded. `src/lib/scheduling/trip-state.js` now exports `PRE_START_TRIP_STATUSES` for the mobile-supported Pending, Approved, Vehicle Assigned, Driver Assigned, Dispatched, Assigned, and Driver Accepted states, and `loadEligibleTrips()` uses that whitelist. A driver assigned before accepting can therefore receive the same start-window notices; dispatcher fan-out still occurs only when `latest_start` (scheduled pickup) is reached. Started, completed, and cancelled statuses remain outside the scan. Dashboard, Calendar, and Trip detail use the same pickup threshold to show a derived no-start warning. No timer changes stored lifecycle state, and no grace period or database setting was added.

The gap: nothing time-driven tells a driver their trip start window opened. Real
push delivery exists end-to-end (notifications + push_outbox → flushOutbox →
Expo → FCM → OS, verified 2026-08-19), but every producer today is
request-triggered. This adds the **first JS time-driven producer**, driven by
the existing authenticated scheduler entry point.

This note is the implementation contract (revised 2026-09-09 after review —
15 corrections captured verbatim below). Docs in [[Notifications]] get updated
only after the implementation matches reality.

## Design contract (the 15 review corrections)

1. **Eligibility is Driver Accepted ONLY.** Not Pending/Approved/Assigned/
   Vehicle Assigned/Driver Assigned/Dispatched. The driver lifecycle is
   Assigned → Driver Accepted → Trip Started; a driver who has not accepted
   cannot start, so a start-window notification for them is noise. Strict
   `trip_status = 'Driver Accepted'` in the scan query.
2. **No inspection wording — and no lying.** The copy never mentions the
   pre-trip inspection, but also never says "you can start your trip" (the
   start endpoint still gates on inspection Passed, vehicle/driver status,
   work schedule). Window-open copy says the *window* is open:
   "Your trip start window is open." The start endpoint's gates are NOT
   touched, weakened, or duplicated.
3. **No third departure-window implementation.** The window math is already
   defined twice: `GET /api/mobile/driver/trips` (preStart enrichment) and
   `PUT /api/trips/[id]/start` (the enforcement gate). Both use
   `computeDepartureWindow()` + the same ETA ladder (TomTom → haversine
   heuristic → stored `COALESCE(r.estimated_duration, tr.estimated_duration)`)
   + `dispatch_policy.departureBufferMinutes/earlyStartAllowanceMinutes`.
   The new producer must reuse that same logic — extract the ETA ladder into
   a shared helper rather than copying it a third time. The start route keeps
   its own authoritative gate; parity is proven by tests.
4. **Three tiers, mapped to delivery channels:**
   - `earliest_start` crossed → title "Trip Start Window Open" — quiet
     heads-up tier (Warning type → `heads-up` channel, no sound, remote push).
   - `recommended_departure` crossed → title "Time to Head to Pickup" —
     loud Alert tier (`default` channel, sound).
   - `latest_start` crossed and still Driver Accepted → late-start gap
     alert (see 6).
5. **Catch-up rule: most-advanced event only.** If the scheduler misses
   earliest_start and the next run is already past recommended_departure,
   emit ONLY the recommended_departure event — not both. One threshold event
   per trip per run.
6. **Late-start gap (included):** `latest_start` (= scheduled pickup) crossed
   while still Driver Accepted → driver gets "Trip Has Not Started" +
   dispatchers get "Scheduled Trip Has Not Started" (operational copy).
   management/system_admin must NOT receive action-required operational copy
   (recipients.js locked audience policy: SILENT_ROLES, OBSERVER_ROLES).
7. **Concurrency-safe dedupe:** serialize per (trip, event) via transaction +
   row lock / advisory lock, then check-then-insert. NO global
   `UNIQUE(title, reference_id)` constraint — existing events legitimately
   repeat titles. Advisory-lock convention per migration 029
   (`pg_advisory_xact_lock(hashtext(...))`).
8. **Multiple thresholds in one scan must not mark unsent rows as pushed** —
   at most one threshold event per trip per run (follows from 5).
9. **Targeted outbox draining:** after inserts, `flushOutbox({ employeeIds:
   affectedEmployeeIds })` — never a global flush.
10. **Notification preferences are deliberate:** new event keys
    `trip_start_window`, `trip_departure_due`, `trip_start_overdue` in
    `NOTIFICATION_EVENTS` (defaults: in_app true, push true, email false).
    The producer READS preferences (first producer to do so) — a disabled
    push channel suppresses the push_outbox row, a disabled in_app channel
    suppresses the notifications row. The mobile Push ON/OFF toggle must also
    sync the server preference (bulk mode), because remote FCM push arrives
    even when the app-local toggle is OFF.
11. **Runs through the existing authenticated `/api/cron/sync` contract** as
    an isolated best-effort step. Returns observability fields:
    `start_window_notifications_created`, `start_window_pushes_attempted`,
    `start_window_skipped`.
12. **Scheduler cadence documented:** target ~once per minute. The endpoint
    is NOT a scheduler — production must configure an external caller +
    CRON_SECRET (same deploy-check as the existing sync steps).
13. **Asia/Manila explicitly** when formatting pickup times in copy.
14. **Deep-link:** `reference_type = "trip"`, `reference_id = trip_id`
    (mobile `mobileNotificationTarget` already routes "trip" → Home tab).
15. **Test coverage (vitest, no DB):** Driver-Accepted-only eligibility;
    earliest threshold; recommended threshold; latest-start overdue
    threshold; no duplicate on repeated scans; overlapping/concurrent scan
    safety; both thresholds crossed in one scan → only the later event; trip
    starts between scans → no later notification; trip cancelled → no
    notification; ETA unavailable / haversine fallback / stored-estimate
    fallback; policy-buffer parity with the start route; notification
    preference disabled; push failure does not fail cron sync; Manila-time
    copy; deep-link reference; targeted outbox flush.

## Implementation map

| Piece | File |
|---|---|
| Event keys (prefs) | `src/lib/constants.js` — NOTIFICATION_EVENTS |
| Shared ETA ladder | `src/lib/scheduling/start-window.js` (new) — extract from the start route + driver-trips route; both keep their behavior, the new service consumes it |
| Microcopy | `src/lib/notifications/copy.js` — 4 entries, Asia/Manila formatter |
| Producer service | `src/services/start-window-notifications.service.js` (new) |
| Cron wiring | `src/app/api/cron/sync/route.js` — isolated step + counters |
| Bulk prefs PUT | `src/app/api/notifications/preferences/route.js` — `bulk` body mode |
| Mobile toggle sync | `mobile/app/(app)/profile/permissions.js` — best-effort PUT |
| Tests | `src/lib/scheduling/start-window.test.js`, `src/lib/notifications/copy.test.js` (additions), `src/services/start-window-notifications.service.test.js`, `src/app/api/cron/sync/route.test.js` (additions) |

## Scan algorithm (per run)

1. Load `dispatch_policy` once.
2. `SELECT` all Driver Accepted trips with: trip_id, driver_id, driver
   employee_id, scheduled_departure (pickup), origin coords, driver current
   position, stored estimate. (Single query, JOINed.)
3. For each trip: resolve ETA via the shared ladder (TomTom once per trip,
   sequential to stay gentle on the routing quota), compute the window, then
   pick the **most advanced crossed threshold**:
   `now >= latest_start → overdue; else now >= recommended_departure → due;
   else now >= earliest_start → window_open; else skip`.
4. Dedupe key: an existing `notifications` row for this driver with the
   event's title and `reference_type='trip'`, `reference_id=trip_id`.
   Because titles are stable (copy.js rule), title IS the event key.
5. Per trip: `withTransaction` → `pg_advisory_xact_lock(hashtext('trip_start_notif_' || trip_id))` →
   re-check dedupe → insert notifications row(s) (+ push_outbox row when the
   push preference is enabled) → commit. One event per trip per run.
6. Collect affected employee ids → single targeted
   `flushOutbox({ employeeIds })` after all transactions.
7. Return `{ created, pushes_attempted, skipped }`.

Overdue fans out to the driver AND dispatchers
(`notificationRolesFor("dispatch", "update_all")` minus silent/observer
roles — never management/system_admin). Window-open and due events go to the
driver only.

## Verification plan

- `npx vitest run` full suite green.
- `npx eslint` on touched files.
- No migration (no schema change) — `npm run db:check` still clean.
- Update [[Notifications]] + [[System Overview]] + SYSTEM.md after green.
- **Do not commit** (user directive).

## Final acceptance checklist — PARTIALLY MET (2026-09-24)

Code-complete ≠ production-ready. `/api/cron/sync` does nothing by itself;
these are the operational gates before this feature is called live. Each item
lists how to run it and what "pass" looks like.

**Live-DB preflight findings (2026-09-09, read-only probe — re-run anytime
with `node scripts/acceptance-preflight.mjs`):**

- `system_settings.cron_sync_last_ok` = **2026-09-06T04:30:43Z** — something
  called the sync three days ago and stopped. **Re-probed 2026-09-24: still
  2026-09-06T04:30:43Z** — the workflow written that day has not yet fired
  (see §1 operator steps).
- pg_cron (in-DB) runs `incident-sla-breach-check` every minute, healthy —
  **plus (2026-09-24): the leftover `test` job (`SELECT 1` every minute,
  ~15,300 garbage runs) was unscheduled** via `scripts/unschedule-test-cron.mjs`
  (owner approval given with the cron-wiring task). Live `cron.job` now holds
  exactly four jobs: `incident-sla-breach-check`, `duty-autoclose-sweep` (126),
  `notifications-purge` (127), `mobile-refresh-token-purge` (128).
- `pg_net` is NOT installed, so pg_cron cannot call the HTTP endpoint from
  inside the DB — the sync scheduler must be external (hosting platform or a
  pinger service). **Landed 2026-09-24:** `.github/workflows/cron-sync.yml`
  (external caller) + `vercel.json` (inert on HostForge, ready for Vercel).
- Zero Driver Accepted trips exist right now, so the live test needs a seeded
  trip (a driver account with a push token, a dispatch with a near-term
  `scheduled_departure`, trip walked to Driver Accepted).

### 1. Configure the real external scheduler (~once a minute) — CODE LANDED, OPERATOR STEPS PENDING

- **Landed 2026-09-24 (uncommitted):**
  - `.github/workflows/cron-sync.yml` — `schedule: "*/5 * * * *"` +
    `workflow_dispatch`; each tick POSTs `/api/cron/reconcile` once, then
    loops 5× `POST /api/cron/sync` with `sleep 60` between hits (GitHub's
    schedule floor is 5 min; the loop recovers the ~1/min target). Fail-loud
    on missing secrets or non-200 (503 = `CRON_SECRET` unset server-side,
    401 = mismatch). `concurrency: cron-sync`, `cancel-in-progress: false`.
  - `vercel.json` — `{"crons": [{"path": "/api/cron/sync", "schedule": "* * * * *"},
    {"path": "/api/cron/reconcile", "schedule": "*/5 * * * *"}]}`. Inert on
    HostForge; if the app returns to Vercel, the platform attaches
    `Authorization: Bearer <CRON_SECRET>` automatically (GET; both routes
    accept GET and POST). Per-minute needs **Vercel Pro** — Hobby caps cron
    frequency at once per day, which is NOT enough for minute-level
    thresholds. Pinned by `src/vercel.crons.test.js`.
  - Caveats accepted (documented in the workflow header): GitHub schedule is
    queued not punctual, default-branch-only, auto-disable after 60 days
    without repo activity. A production deployment wants a real platform
    cron with the same secret and URL.
- **Operator steps still required (none doable from the repo alone):**
  1. Merge the workflow to **`main`** (schedule/workflow_dispatch only run
     on the default branch).
  2. GitHub → Settings → Secrets → Actions: `APP_BASE_URL` =
     `https://fleetopss.horecaos.net`, `CRON_SECRET` = production value.
  3. HostForge → set env `CRON_SECRET` (same value) → restart/redeploy.
  4. Actions → cron-sync → **Run workflow** once; expect green.
- **Pass:** `cron_sync_last_ok` heartbeat in `system_settings` goes fresh
  (and the system-health dashboard flips to Operational), and
  `start_window_*` counters appear in every sync response.
  Re-check with `node scripts/acceptance-preflight.mjs`.

### 2. Verify CRON_SECRET in the production environment — PENDING OPERATOR

- Present in **both** the hosting provider's Production env settings (the
  route is fail-closed without it — every call returns 503) **and** the
  GitHub Actions repository secret (the workflow fails the run if either
  `APP_BASE_URL` or `CRON_SECRET` is missing). `.env.local` has the dev
  value; production is a separate setting.
- **Pass:** an unauthenticated curl gets 401/503; the authenticated
  scheduler's calls return 200; the Actions run is green.

### 3. One real trip, three app states (foreground / background / killed)

- Seed a Driver Accepted trip with a `scheduled_departure` ~30–40 min out and
  a driver position posted within the last 10 minutes (post a GPS ping or log
  a location from the app so `drivers.last_location_update` is fresh).
- Hold the phone in each state across a threshold crossing.
- **Pass:** the remote push arrives on the OS level in all three states
  (foreground banner, background notification, killed-device push — the
  Expo→FCM/APNs path delivers without the app running).

### 4. Confirm each threshold's tier and timing

| Crossing | Expect |
|---|---|
| `earliest_start` | "Trip Start Window Open" — **quiet**: heads-up channel, no sound |
| `recommended_departure` | "Time to Head to Pickup" — **loud**: default channel, sound |
| `latest_start` (pickup passed, still Driver Accepted) | driver "Trip Has Not Started" + every dispatcher "Scheduled Trip Has Not Started" |

- **Pass:** right title, right tier (sound vs silence), within ~1 min of the
  threshold, Manila-time pickup in the message, and tapping the push lands on
  the trip (deep-link `reference_type: "trip"`).

### 5. Push OFF suppresses remote pushes

- Toggle **Push Notifications OFF** in the app (Profile → Permissions). The
  toggle now bulk-writes the server preference; remote pushes stop while the
  in-app row (in_app default on) is still created.
- **Pass:** no OS push at the next crossed threshold, but the notification
  still appears in the app's in-box. Toggle back ON and confirm the next
  push arrives again.

### 6. Start/cancel before the next threshold

- Start the trip (or cancel it) between two thresholds.
- **Pass:** no stale notification afterwards — the scan only sees
  `Driver Accepted` trips, so a started/cancelled trip is invisible to later
  runs; and an already-sent event never repeats (title dedupe).

### Watch item: stale driver location (now recorded)

The ETA keys off `drivers.current_latitude/longitude`, whose age is only
visible via `last_location_update`. A driver who hasn't posted recently makes
the window legitimately based on stale position data — pre-existing
behavior, not a bug of this feature, but during acceptance watch the
**`start_window_stale_locations`** counter in the sync response (added
2026-09-09): it counts eligible trips whose position fed the ETA but is
older than 10 minutes or of unknown age. A non-zero value during the live
test means the observed window (and thus the notification timing) was
computed from where the driver WAS, not is.
