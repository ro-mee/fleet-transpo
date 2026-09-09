// Notification preference resolution — the read side of the
// notification_preferences table (migration 037). The table existed with a
// working API since 037 but no producer ever read it: everyone got
// everything. Producers now call these helpers so a user's channel opt-out
// is honored at fan-out time.
//
// Resolution rule (locked by 037): a row for (employee, event, channel)
// overrides; an ABSENT row inherits the NOTIFICATION_EVENTS default. There
// is intentionally no global per-employee kill switch row — the bulk sync
// (mobile Push toggle) writes one row per event for the channel instead.

import { query } from "@/lib/db";
import { NOTIFICATION_EVENTS } from "@/lib/constants";

/**
 * Whether a channel is enabled for one employee + event. Pure — safe to
 * unit-test.
 *
 * @param {object} p
 * @param {Array<{employee_id:number, event_key:string, channel:string, enabled:boolean}>} p.preferenceRows
 *   rows for the relevant employees/events, as loaded by loadPreferenceRows
 * @param {number} p.employeeId
 * @param {string} p.eventKey   key in NOTIFICATION_EVENTS
 * @param {string} p.channel    in_app | email | push
 * @param {object} [p.events]   NOTIFICATION_EVENTS by default (injectable for tests)
 * @returns {boolean}
 */
export function channelEnabled({ preferenceRows, employeeId, eventKey, channel, events = NOTIFICATION_EVENTS }) {
  const row = (preferenceRows || []).find(
    (r) =>
      Number(r.employee_id) === Number(employeeId) &&
      r.event_key === eventKey &&
      r.channel === channel
  );
  if (row) return row.enabled === true;
  return Boolean(events[eventKey]?.defaults?.[channel]);
}

/**
 * Load preference rows for a set of employees, restricted to the given event
 * keys so a scan never reads the whole table.
 *
 * @param {number[]} employeeIds
 * @param {string[]} eventKeys
 * @returns {Promise<Array>} notification_preferences rows
 */
export async function loadPreferenceRows(employeeIds, eventKeys) {
  const ids = [...new Set((employeeIds || []).map(Number).filter(Boolean))];
  const keys = (eventKeys || []).filter((k) => k in NOTIFICATION_EVENTS);
  if (!ids.length || !keys.length) return [];
  const { rows } = await query(
    `SELECT employee_id, event_key, channel, enabled
       FROM notification_preferences
      WHERE employee_id = ANY($1) AND event_key = ANY($2)`,
    [ids, keys]
  );
  return rows;
}
