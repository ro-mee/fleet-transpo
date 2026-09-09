// Time-driven trip start-window notifications — the first JS producer that
// fires on TIME rather than on a request. Called from /api/cron/sync (~once
// a minute target; the endpoint is not a scheduler — an external caller with
// CRON_SECRET must be configured in production).
//
// For every Driver Accepted trip (strict lifecycle Assigned → Driver
// Accepted → Trip Started — a driver who hasn't accepted cannot start, so a
// start-window notification for them is noise), resolve the departure
// window with the SAME shared ladder the start gate and the driver trips
// feed use (src/lib/scheduling/start-window.js), then notify at each
// threshold:
//
//   earliest_start crossed        → "Trip Start Window Open"  (quiet heads-up)
//   recommended_departure crossed → "Time to Head to Pickup" (loud Alert)
//   latest_start (pickup) passed  → "Trip Has Not Started" (driver, loud)
//                                  + "Scheduled Trip Has Not Started" (dispatchers)
//
// Rules locked by the implementation plan (Capstone/01 - System/Trip Start
// Window Notifications Implementation Plan.md):
//   - Catch-up: one threshold event per trip per run — only the MOST
//     ADVANCED crossed threshold fires (a scan that slept through
//     earliest_start jumps straight to departure_due or overdue).
//   - Dedupe: per (employee, title, reference) — titles are stable (copy.js
//     rule) so the title IS the event key. No global unique constraint
//     (other events legitimately repeat titles).
//   - Concurrency: per-trip advisory lock inside a transaction, then
//     check-then-insert, so two overlapping scans can never double-notify
//     (pg_advisory_xact_lock, the migration 029 convention).
//   - Copy never mentions the pre-trip inspection and never claims "you can
//     start your trip" — the start endpoint still gates on inspection,
//     vehicle/driver status and work schedule, and is untouched by this.
//   - Preferences are honored: a disabled in_app channel suppresses the
//     notifications row, a disabled push channel suppresses the outbox row
//     (this is the first producer that reads notification_preferences).
//   - Staff fan-out (overdue only) goes through the locked audience policy:
//     dispatchers get operational copy; management/system_admin never do.
//
// Best-effort per trip by design: one trip's failure must never stop the
// scan for the others, and the whole sync never throws (a producer failure
// must not fail the cron run).

import { query, withTransaction } from "@/lib/db";
import { mergeDispatchPolicy } from "@/lib/dispatch-policy";
import { resolveStartWindow, crossedStartWindowThreshold } from "@/lib/scheduling/start-window";
import { notificationRolesFor, employeeIdsForRoles, dedupeEmployeeIds } from "@/lib/notifications/recipients";
import { loadPreferenceRows, channelEnabled } from "@/lib/notifications/preferences";
import { flushOutbox, CHANNEL } from "@/services/push.service";
import {
  tripStartWindowOpen,
  timeToHeadToPickup,
  tripNotStartedDriver,
  tripNotStartedStaff,
} from "@/lib/notifications/copy";

// A driver position older than this (or of unknown age) still feeds the ETA
// ladder — the window is then legally based on where the driver WAS, not is.
// Flagged in the sync counters so acceptance testing can see it. Matches the
// completion route's 10-minute GPS freshness convention.
export const STALE_LOCATION_MINUTES = 10;

/**
 * True when the driver position feeding this trip's ETA exists but cannot be
 * vouched for: last_location_update is missing (age unknown) or older than
 * STALE_LOCATION_MINUTES. A NULL position returns false — that trip's ETA
 * fell back to the stored duration and used no location at all.
 */
export function locationIsStale(trip, now = new Date()) {
  if (trip.current_latitude == null || trip.current_longitude == null) return false;
  if (!trip.last_location_update) return true;
  return now - new Date(trip.last_location_update) > STALE_LOCATION_MINUTES * 60 * 1000;
}

// Which copy + tier each threshold maps to. type drives deliveryFor() both
// here (outbox channel) and in the mobile feed: Warning → quiet heads-up
// channel, no sound; Alert → loud default channel with sound.
export const THRESHOLD_EVENTS = {
  window_open: {
    eventKey: "trip_start_window",
    type: "Warning",
    channel: CHANNEL.HEADS_UP.id,
    driverCopy: tripStartWindowOpen,
  },
  departure_due: {
    eventKey: "trip_departure_due",
    type: "Alert",
    channel: CHANNEL.PUSH.id,
    driverCopy: timeToHeadToPickup,
  },
  overdue: {
    eventKey: "trip_start_overdue",
    type: "Alert",
    channel: CHANNEL.PUSH.id,
    driverCopy: tripNotStartedDriver,
    staffCopy: tripNotStartedStaff,
  },
};

/**
 * Driver Accepted trips awaiting a start, with everything the window needs.
 * Driver Accepted ONLY — see the module header.
 */
export async function loadEligibleTrips() {
  const { rows } = await query(
    `SELECT t.trip_id, t.driver_id,
            emp.employee_id AS driver_employee_id,
            (emp.first_name || ' ' || emp.last_name) AS driver_name,
            ds.scheduled_departure AS pickup,
            ol.latitude  AS pickup_latitude,
            ol.longitude AS pickup_longitude,
            dr.current_latitude, dr.current_longitude, dr.last_location_update,
            COALESCE(r.estimated_duration, tr.estimated_duration) AS estimated_duration
       FROM trips t
       JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id AND ds.deleted_at IS NULL
       JOIN drivers dr ON dr.driver_id = t.driver_id AND dr.deleted_at IS NULL
       JOIN employees emp ON emp.employee_id = dr.employee_id AND emp.deleted_at IS NULL
       LEFT JOIN routes r ON r.route_id = t.route_id
       LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
       LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
      WHERE t.trip_status = 'Driver Accepted'
        AND t.deleted_at IS NULL`
  );
  return rows;
}

/** [lat, lng] from a DB row's two nullable columns, or null. */
function position(lat, lng) {
  return lat != null && lng != null ? [Number(lat), Number(lng)] : null;
}

/**
 * Has this employee already been notified of this event for this trip?
 * Dedupe key = (employee_id, title, reference_type, reference_id) — titles
 * are stable event names, so this is per (employee, trip, threshold).
 */
export async function alreadyNotified(tx, employeeId, title, tripId) {
  const { rows } = await tx.query(
    `SELECT 1 FROM notifications
      WHERE employee_id = $1 AND title = $2
        AND reference_type = 'trip' AND reference_id = $3
      LIMIT 1`,
    [employeeId, title, tripId]
  );
  return rows.length > 0;
}

/**
 * One trip's scan step. Resolves the REAL window (same ETA ladder as the
 * start gate — a cheaper pre-screen would drift from the gate whenever
 * traffic makes TomTom's ETA exceed the heuristic), picks the most advanced
 * crossed threshold, then: transaction → per-trip advisory lock →
 * dedupe re-check → insert. One threshold event per trip per run.
 *
 * @returns {{ created:number, pushRecipients:number[], skipped:boolean, staleLocation:boolean }}
 */
export async function processTrip({ trip, policy, preferenceRows, dispatcherIds, now = new Date(), fetchImpl = fetch }) {
  const staleLocation = locationIsStale(trip, now);
  const window = await resolveStartWindow({
    pickup: trip.pickup,
    driverPosition: position(trip.current_latitude, trip.current_longitude),
    pickupPosition: position(trip.pickup_latitude, trip.pickup_longitude),
    storedDurationMinutes: trip.estimated_duration,
    departureBufferMinutes: policy.departureBufferMinutes,
    earlyStartAllowanceMinutes: policy.earlyStartAllowanceMinutes,
    fetchImpl,
  });
  const threshold = crossedStartWindowThreshold(window, now);
  if (!threshold) return { created: 0, pushRecipients: [], skipped: true, staleLocation };

  const event = THRESHOLD_EVENTS[threshold];

  // Audience: the driver for every threshold; dispatchers additionally on
  // overdue (operational copy; management/system_admin never — locked
  // audience policy). Every recipient is subject to their own preferences.
  const recipients = [];
  if (threshold === "overdue") {
    const staffCopy = event.staffCopy({ driverName: trip.driver_name, pickup: trip.pickup });
    for (const id of dispatcherIds) {
      recipients.push({ employeeId: id, copy: staffCopy, eventKey: event.eventKey });
    }
  }
  const driverCopy = event.driverCopy({ pickup: trip.pickup, etaMinutes: window?.eta_minutes });
  recipients.push({ employeeId: Number(trip.driver_employee_id), copy: driverCopy, eventKey: event.eventKey });

  let created = 0;
  const pushRecipients = [];
  const inserted = [];
  await withTransaction(async (tx) => {
    // Serialize per trip: a concurrent scan holding this lock has already
    // decided this run's event for this trip (or is mid-insert); after it
    // commits, the dedupe re-check below sees its rows.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('trip_start_notif_' || $1))`, [trip.trip_id]);

    for (const r of recipients) {
      const inApp = channelEnabled({
        preferenceRows,
        employeeId: r.employeeId,
        eventKey: r.eventKey,
        channel: "in_app",
      });
      const push = channelEnabled({
        preferenceRows,
        employeeId: r.employeeId,
        eventKey: r.eventKey,
        channel: "push",
      });
      if (!inApp && !push) continue;
      if (await alreadyNotified(tx, r.employeeId, r.copy.title, trip.trip_id)) continue;

      if (inApp) {
        await tx.query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, 'trip', $5)`,
          [r.employeeId, r.copy.title, r.copy.message, event.type, trip.trip_id]
        );
        created += 1;
      }
      if (push) {
        await tx.query(
          `INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, 'trip', $5)`,
          [r.employeeId, r.copy.title, r.copy.pushBody, event.channel, trip.trip_id]
        );
        created += 1;
        pushRecipients.push(r.employeeId);
      }
      inserted.push(r.employeeId);
    }
  });
  return { created, pushRecipients, skipped: inserted.length === 0, staleLocation };
}

/**
 * Scan every Driver Accepted trip and notify crossed start-window
 * thresholds. Best-effort per trip; never throws (a producer failure must
 * not fail the cron sync).
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  injectable fetch (tests)
 * @param {Date} [opts.now]                injectable clock (tests)
 * @returns {Promise<{created:number, pushes_attempted:number, skipped:number, errors:number, stale_locations:number}>}
 */
export async function syncStartWindowNotifications(opts = {}) {
  const { fetchImpl = fetch, now = new Date() } = opts;
  try {
    const policy = mergeDispatchPolicy(
      (await query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'dispatch_policy' LIMIT 1`
      )).rows[0]?.setting_value
    );

    const trips = await loadEligibleTrips();
    if (!trips.length) return { created: 0, pushes_attempted: 0, skipped: 0, errors: 0, stale_locations: 0 };

    const dispatcherIds = await employeeIdsForRoles(notificationRolesFor("dispatch", "update_all"));
    const preferenceRows = await loadPreferenceRows(
      dedupeEmployeeIds([...trips.map((t) => t.driver_employee_id), ...dispatcherIds]),
      Object.values(THRESHOLD_EVENTS).map((e) => e.eventKey)
    );

    let created = 0;
    let skipped = 0;
    let errors = 0;
    let stale_locations = 0;
    const pushEmployeeIds = new Set();

    for (const trip of trips) {
      try {
        const result = await processTrip({ trip, policy, preferenceRows, dispatcherIds, now, fetchImpl });
        created += result.created;
        if (result.skipped) skipped += 1;
        if (result.staleLocation) stale_locations += 1;
        result.pushRecipients.forEach((id) => pushEmployeeIds.add(id));
      } catch (e) {
        // One trip's failure must never stop the scan for the others.
        errors += 1;
        console.warn(`start-window notification for trip ${trip.trip_id} failed:`, e?.message || e);
      }
    }

    // Targeted drain: only the employees we just enqueued rows for. Never a
    // global flush — that would deliver unrelated pending rows out of band.
    // flushOutbox never throws by contract; the guard is for a broken mock or
    // a future refactor — a push failure must never zero out this scan's
    // created count or fail the cron sync.
    let pushes_attempted = 0;
    if (pushEmployeeIds.size) {
      pushes_attempted = pushEmployeeIds.size;
      try {
        await flushOutbox({ employeeIds: [...pushEmployeeIds] });
      } catch (e) {
        console.warn("start-window outbox flush failed:", e?.message || e);
      }
    }

    return { created, pushes_attempted, skipped, errors, stale_locations };
  } catch (e) {
    console.warn("syncStartWindowNotifications failed:", e?.message || e);
    return { created: 0, pushes_attempted: 0, skipped: 0, errors: 1, stale_locations: 0 };
  }
}
