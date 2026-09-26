// Time-driven End Duty reminders — the first producer whose subject is a
// driver's OWN unfinished paperwork rather than an event that happened to them.
//
// Every other producer here notifies about something that occurred (a dispatch,
// a trip window, an incident, a sign-in). This one notifies about something
// that has NOT occurred yet, which is why it needs two rules the others do not:
//
//   - It must not fire while the driver can still legitimately be at work. The
//     mobile nudge window opens 30 minutes BEFORE the shift ends; this grace
//     starts AFTER it. A driver still driving home has not forgotten anything.
//   - Its dedupe key must roll over every day. Titles are stable event names
//     and the title IS the dedupe key (copy.js rule), so the per-day half lives
//     in reference_id = the duty date as YYYYMMDD. A constant there would notify
//     a driver once ever and silently swallow every later day — the failure mode
//     this module is most likely to grow, and the one two tests pin.
//
// Ladder (mirrors the start-window producer):
//   shift end + 30 min → "End Duty Reminder"           quiet heads-up, no sound
//   shift end + 2 h    → "End Duty Still Not Reported" loud default, sound
//   catch-up           → only the MOST ADVANCED crossed stage fires
//
// Dedupe: per (employee, title, reference_id) under a per-attendance advisory
// lock, then check-then-insert — the migration 029 convention, so two
// overlapping scans cannot double-notify.
//
// Preferences are honoured exactly as the start-window producer honours them: a
// disabled in_app suppresses the notifications row, a disabled push suppresses
// the outbox row.
//
// Best-effort per driver: one driver's failure never stops the scan, and the
// whole run never throws — a producer failure must not fail the cron sync.
//
// HONEST LIMIT: a driver with no active `device_tokens` row receives nothing.
// `flushOutbox` reports that as `error` rather than silence, and the sync
// counters below surface it, but nothing here can fix it — the app must have
// been signed in on a real device build at least once.

import { query, withTransaction } from "@/lib/db";
import { flushOutbox, CHANNEL } from "@/services/push.service";
import { loadPreferenceRows, channelEnabled } from "@/lib/notifications/preferences";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { driverDayEligibility } from "@/lib/scheduling/day-eligibility";
import { crossedEndDutyThreshold, dutyDayKey } from "@/lib/scheduling/end-duty-thresholds";
import { endDutyReminder, endDutyStillNotReported } from "@/lib/notifications/copy";

export const END_DUTY_EVENT = "end_duty_reminder";
export const END_DUTY_REFERENCE_TYPE = "duty";

/** Stable titles ARE the dedupe key. Never interpolate anything into these. */
const STAGE = {
  reminder: {
    title: "End Duty Reminder",
    channelId: CHANNEL.HEADS_UP.id,
    build: endDutyReminder,
  },
  overdue: {
    title: "End Duty Still Not Reported",
    channelId: CHANNEL.PUSH.id,
    build: endDutyStillNotReported,
  },
};

/**
 * Open attendance rows — checked in, never checked out.
 *
 * Deliberately not scoped to today: a shift ending at 23:00 is still owed after
 * midnight, and Part A's 04:00 sweep is what ends that window by writing a
 * `time_out`. Until it does, the row is open and the driver still owes a report,
 * so the row's own date decides the threshold and this query does not guess.
 */
const OPEN_DUTIES_SQL = `
  SELECT a.attendance_id, a.driver_id, a.date, a.time_in, a.time_out,
         d.employee_id
    FROM driverattendance a
    JOIN drivers d ON d.driver_id = a.driver_id
   WHERE a.time_in IS NOT NULL
     AND a.time_out IS NULL
     AND d.employee_id IS NOT NULL
   ORDER BY a.date, a.driver_id
`;

// Dedupe reads BOTH tables. A notifications-only lookup silently re-enqueues
// on every tick for a driver who turned in_app off: no notifications row is
// ever written, so nothing ever trips the guard and the same stage pushes a
// fresh outbox row ~once a minute until it advances. Either row proves the
// stage was already delivered.
async function alreadyNotified(tx, employeeId, title, referenceId) {
  const { rows } = await tx.query(
    `SELECT 1 FROM notifications
       WHERE employee_id = $1 AND title = $2 AND reference_type = $3 AND reference_id = $4
      UNION ALL
     SELECT 1 FROM push_outbox
       WHERE employee_id = $1 AND title = $2 AND reference_type = $3 AND reference_id = $4
      LIMIT 1`,
    [employeeId, title, END_DUTY_REFERENCE_TYPE, referenceId]
  );
  return rows.length > 0;
}

/**
 * Insert the reminder for one open duty, under its own advisory lock.
 *
 * @returns {Promise<{created:number, pushRecipients:number[]}>}
 */
async function notifyOne({ duty, stage, copy, preferenceRows }) {
  const referenceId = dutyDayKey(duty.date);
  if (referenceId == null) return { created: 0, pushRecipients: [] };

  const inApp = channelEnabled({
    preferenceRows, employeeId: duty.employee_id, eventKey: END_DUTY_EVENT, channel: "in_app",
  });
  const push = channelEnabled({
    preferenceRows, employeeId: duty.employee_id, eventKey: END_DUTY_EVENT, channel: "push",
  });
  if (!inApp && !push) return { created: 0, pushRecipients: [] };

  let created = 0;
  const pushRecipients = [];

  await withTransaction(async (tx) => {
    // Serialize per attendance row: a concurrent scan holding this lock has
    // already decided this run's stage for this duty (or is mid-insert); after
    // it commits, the dedupe re-check below sees its rows.
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtext('end_duty_reminder_' || $1))`,
      [duty.attendance_id]
    );

    if (await alreadyNotified(tx, duty.employee_id, copy.title, referenceId)) return;

    if (inApp) {
      await tx.query(
        `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [duty.employee_id, copy.title, copy.message, stage === "overdue" ? "Alert" : "Warning",
         END_DUTY_REFERENCE_TYPE, referenceId]
      );
      created += 1;
    }
    if (push) {
      await tx.query(
        `INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [duty.employee_id, copy.title, copy.pushBody, STAGE[stage].channelId,
         END_DUTY_REFERENCE_TYPE, referenceId]
      );
      created += 1;
      pushRecipients.push(duty.employee_id);
    }
  });

  return { created, pushRecipients };
}

/**
 * Scan every open duty and remind the driver when its stage has been crossed.
 *
 * Best-effort per driver; never throws (a producer failure must not fail the
 * cron sync).
 *
 * @param {object} [opts]
 * @param {Date} [opts.now]  injectable clock (tests)
 * @returns {Promise<{created:number, pushes_attempted:number, scanned:number, skipped:number, errors:number}>}
 */
export async function syncEndDutyReminders({ now = new Date() } = {}) {
  const counters = { created: 0, pushes_attempted: 0, scanned: 0, skipped: 0, errors: 0 };

  try {
    const { rows: duties } = await query(OPEN_DUTIES_SQL);
    if (!duties.length) return counters;

    // Both arguments are required: `loadPreferenceRows` returns [] when either
    // is empty, and `channelEnabled` falls back to NOTIFICATION_EVENTS defaults
    // for an absent row — so calling it bare would silently push to every
    // driver who turned the channel off. The start-window producer passes both.
    const employeeIds = duties.map((d) => d.employee_id);
    const preferenceRows = await loadPreferenceRows(employeeIds, [END_DUTY_EVENT]);
    const ctx = await loadDriverScheduleContext(duties.map((d) => d.driver_id));
    const pushRecipients = [];

    for (const duty of duties) {
      counters.scanned += 1;
      try {
        // The roster out-time, read through the same helper pair the duty
        // endpoint answers from — never re-derived here, or the reminder and
        // the setDuty gate would be two computations that can drift.
        const { blocked, duty: window } = driverDayEligibility({
          driverId: duty.driver_id,
          date: duty.date,
          ctx,
        });
        if (blocked || !window?.end) {
          counters.skipped += 1;
          continue;
        }

        const stage = crossedEndDutyThreshold({
          dutyDate: duty.date,
          shiftEnd: window.end,
          now,
        });
        if (!stage) {
          counters.skipped += 1;
          continue;
        }

        const copy = STAGE[stage].build({ shiftEnd: window.end });
        const { created, pushRecipients: targets } = await notifyOne({
          duty, stage, copy, preferenceRows,
        });
        counters.created += created;
        pushRecipients.push(...targets);
      } catch (e) {
        counters.errors += 1;
        console.warn(`end duty reminder failed for attendance ${duty.attendance_id}:`, e?.message || e);
      }
    }

    if (pushRecipients.length) {
      const unique = [...new Set(pushRecipients)];
      counters.pushes_attempted = unique.length;
      // Targeted flush, never global: the start-window producer established
      // this so a scan cannot accidentally deliver another producer's backlog.
      await flushOutbox({ employeeIds: unique });
    }
  } catch (e) {
    counters.errors += 1;
    console.warn("syncEndDutyReminders failed:", e?.message || e);
  }

  return counters;
}
