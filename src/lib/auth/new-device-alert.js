// Tell an account owner when their account is used from a device it has never
// been used from.
//
// This is detection, not enforcement: mandatory email OTP already stops anyone
// who has the password but not the inbox. What this covers is the case the OTP
// deliberately does NOT cover — the 7-day trusted-device bypass, where a
// remembered browser skips the code entirely, so a stolen cookie would
// otherwise pass with nothing said. It also covers the ordinary "someone else
// is using my account" case, which is the question that prompted it.
//
// Deliberately absent: any location or country signal. IP geolocation maps
// ranges to the ISP's registered place rather than to a user's position, so
// two points inside one metro (Manila vs Makati, ~10 km) cannot be separated —
// such a rule would fire on the owner and miss the attacker. See the Decision
// Log for the full rationale.
//
// Best-effort throughout: modelled on `flushOutbox`, no fault in here may deny
// a valid sign-in.
import { query, withTransaction } from "@/lib/db";
import { sessionDeviceLabel } from "./sessions";
import { isDeliverableEmailAddress } from "./otp-policy";
import { loadPreferenceRows, channelEnabled } from "@/lib/notifications/preferences";
import { flushOutbox } from "@/services/push.service";
import { isEmailConfigured, sendNewSignInAlertEmail } from "@/lib/email/smtp";

/** Key in NOTIFICATION_EVENTS (src/lib/constants.js). */
export const NEW_DEVICE_EVENT_KEY = "new_sign_in";

/** How far back a sign-in counts as precedent for "a device we have seen". */
export const NEW_DEVICE_WINDOW_DAYS = 90;

/**
 * The comparison key for a stored `login_success` audit row.
 *
 * The channel matters: `sessionDeviceLabel` returns a constant for mobile
 * ("FleetOps Driver app"), so mobile rows all collapse to one label. That is a
 * real limit on what this check can do for drivers — see the note on
 * `recordNewDeviceAlert`.
 *
 * @param {{user_agent?: string|null, channel?: string|null}} row
 * @returns {string}
 */
export function deviceLabelForRow(row = {}) {
  return sessionDeviceLabel(row.user_agent, row.channel === "mobile" ? "mobile" : "web");
}

/**
 * Whether any prior sign-in used this same device label. Pure.
 *
 * @param {Array} priorRows  rows from `loadPriorLogins`
 * @param {string} label
 * @returns {boolean}
 */
export function isKnownDevice(priorRows, label) {
  return (priorRows || []).some((r) => deviceLabelForRow(r) === label);
}

/**
 * Whether this sign-in warrants a notice. Pure.
 *
 * No prior history means a brand-new account, which has nothing to compare
 * against — onboarding must not produce a spurious "was that you?" alert.
 *
 * @param {Array} priorRows
 * @param {string} label
 * @returns {boolean}
 */
export function shouldAlert(priorRows, label) {
  const rows = priorRows || [];
  if (rows.length === 0) return false;
  return !isKnownDevice(rows, label);
}

/**
 * Notification copy for a new-device sign-in. Pure.
 *
 * @param {string} label  e.g. "Chrome on Windows"
 */
export function newDeviceCopy(label) {
  return {
    title: "New sign-in to your account",
    message:
      `We noticed a sign-in from ${label}. If this was you, no action is needed. ` +
      `If it wasn't, change your password and tell your administrator.`,
    pushBody: `${label} — was this you?`,
  };
}

/**
 * This employee's successful sign-ins inside the window, oldest first.
 *
 * `resource_id` carries the employee id: `writeAudit` is called with a null
 * session during login, so `employee_id` on these rows is NULL and
 * `idx_audit_employee` does not help. `idx_audit_resource (resource,
 * resource_id)` does.
 *
 * @param {number} employeeId
 */
async function loadPriorLogins(employeeId) {
  const { rows } = await query(
    `SELECT user_agent, new_values->>'channel' AS channel
       FROM audit_logs
      WHERE resource = 'authentication'
        AND action = 'login_success'
        AND resource_id = $1
        AND created_at > NOW() - make_interval(days => $2::int)`,
    [employeeId, NEW_DEVICE_WINDOW_DAYS]
  );
  return rows;
}

/**
 * Best-effort email leg of the notice.
 *
 * Its own try/catch, deliberately not the outer one: by the time this runs the
 * in-app row is already committed, so a mail failure must not be reported as a
 * failed alert.
 *
 * Gated the same way the login OTP is — an unconfigured transport or a
 * non-deliverable address (a seed or fixture domain) is skipped rather than
 * attempted, because a bounce spends sender reputation and the message would
 * never have arrived anyway.
 *
 * @param {string|undefined} email
 * @param {string} label
 */
async function sendAlertEmail(email, label) {
  if (!email) return;
  if (!isEmailConfigured() || !isDeliverableEmailAddress(email)) return;
  try {
    await sendNewSignInAlertEmail({ to: email, deviceLabel: label });
  } catch {
    // Missed email; the in-app notice stands.
  }
}

/**
 * If this sign-in is from an unfamiliar device, notify the account owner
 * in-app, by push, and by email.
 *
 * Call this BEFORE writing the `login_success` audit row for the sign-in being
 * judged, so that row cannot act as its own precedent. The ordering is also
 * what makes the check self-deduping: once a label is in history it can never
 * fire again.
 *
 * **Mobile coverage is weaker than it looks.** The app sends no
 * device-identifying user agent, and `sessionDeviceLabel` returns the constant
 * "FleetOps Driver app" for the mobile channel — so every driver sign-in on
 * every phone shares one label. In practice this means a driver is notified at
 * most once, on their first mobile sign-in, and a second phone would not be
 * distinguished. Closing that needs the app to send a device model/id; until
 * then, treat this as a web control.
 *
 * Never throws, and never returns anything the caller must act on — a failure
 * here is a missed notification, never a failed login.
 *
 * @param {object} p
 * @param {{employee_id: number, email?: string}} p.employee
 * @param {string|null} [p.userAgent]
 * @param {"web"|"mobile"} [p.kind]
 * @returns {Promise<{alerted: boolean, reason?: string, label?: string}>}
 */
export async function recordNewDeviceAlert({ employee, userAgent = null, kind = "web" }) {
  try {
    const employeeId = Number(employee?.employee_id);
    if (!employeeId) return { alerted: false, reason: "no_employee" };

    const label = sessionDeviceLabel(userAgent, kind);

    let priorRows;
    try {
      priorRows = await loadPriorLogins(employeeId);
    } catch {
      // Cannot establish history, so cannot claim a device is unfamiliar.
      // Silence beats a false accusation.
      return { alerted: false, reason: "history_unavailable" };
    }

    if (!shouldAlert(priorRows, label)) {
      return { alerted: false, reason: priorRows.length ? "known_device" : "no_history" };
    }

    const preferenceRows = await loadPreferenceRows([employeeId], [NEW_DEVICE_EVENT_KEY]);
    const inApp = channelEnabled({
      preferenceRows,
      employeeId,
      eventKey: NEW_DEVICE_EVENT_KEY,
      channel: "in_app",
    });
    const push = channelEnabled({
      preferenceRows,
      employeeId,
      eventKey: NEW_DEVICE_EVENT_KEY,
      channel: "push",
    });
    // Email is what makes this alert work when the owner is not in the app —
    // the state a stolen credential is used in. It is the only notification
    // event actually wired to email (see BUG-NOTIF-001).
    const email = channelEnabled({
      preferenceRows,
      employeeId,
      eventKey: NEW_DEVICE_EVENT_KEY,
      channel: "email",
    });
    if (!inApp && !push && !email) return { alerted: false, reason: "opted_out" };

    const copy = newDeviceCopy(label);

    // reference_id is the employee's own id. It must be non-null: `target.js`
    // returns no href when it is null (so the tap would do nothing), and
    // `flushOutbox` matches `notifications.pushed_at` on
    // (employee_id, reference_type, reference_id), where `= NULL` never
    // matches. `type: 'Alert'` is the loud push tier (push.service PUSH_TYPES).
    // Skipped entirely when both in-app and push are off (an email-only
    // recipient): no point opening a transaction that would insert nothing.
    if (inApp || push) {
      await withTransaction(async (tx) => {
        if (inApp) {
          await tx.query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, 'Alert', 'security', $1)`,
            [employeeId, copy.title, copy.message]
          );
        }
        if (push) {
          await tx.query(
            `INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
             VALUES ($1, $2, $3, 'default', 'security', $1)`,
            [employeeId, copy.title, copy.pushBody]
          );
        }
      });
    }

    // Its own catch, and not only for tidiness: this sits between the committed
    // in-app row and the email leg below, so an unhandled push failure would
    // suppress the email and report the whole alert as an error. Push is the
    // one channel we already know can reach nobody (no device_tokens row), so
    // it must not be able to take the others down with it.
    if (push) {
      try {
        await flushOutbox({ employeeIds: [employeeId] });
      } catch {
        // Missed push; the in-app row and the email still stand.
      }
    }

    // Awaited rather than fired and forgotten. This path runs only when the
    // alert actually fired — once per device, not once per login — so the mail
    // round trip costs the ordinary login nothing; and a detached send can be
    // lost when the invocation ends with the response, which would make
    // delivery depend on timing.
    if (email) await sendAlertEmail(employee?.email, label);

    return { alerted: true, label };
  } catch {
    return { alerted: false, reason: "error" };
  }
}
