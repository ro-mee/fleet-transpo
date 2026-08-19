// Real push delivery through Expo Push Service.
//
// The notifications table is the source of truth; these functions are the
// delivery side. `sendPush` reads the device tokens registered for the target
// employees and hands the message to Expo's hosted service, which delivers to
// the OS even when the app is killed. Everything here is best-effort: a push
// failure must never affect the notification write that triggered it, so
// `sendPush` never throws.
import { query } from "@/lib/db";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

// Mirrors the mobile tier rule (mobile/lib/notifications/tiers.js). Every row
// that earns an OS-level surface gets a real push — but push-tier rows are
// loud (high-importance channel, sound) while heads-up-tier rows are quiet
// (low-importance channel, no sound, still on the shade/lock screen). Kept on
// the server so it decides before sending rather than shipping every row.
const PUSH_TYPES = new Set(["Alert", "Emergency"]);
const PUSH_SEVERITIES = new Set(["Critical", "Major"]);
const HEADS_UP_TYPES = new Set(["Warning"]);
const HEADS_UP_SEVERITIES = new Set(["Moderate"]);

/** The Android channel + sound used for each tier. */
export const CHANNEL = {
  PUSH: { id: "default", sound: "default" },
  HEADS_UP: { id: "heads-up", sound: false },
};

/**
 * Decide how (if at all) a notifications row is pushed to the OS.
 *
 * @param {object} row  a notifications row (type, severity, reference_type)
 * @returns {{kind:"push", channelId:string, sound:string|boolean}|{kind:"heads-up", channelId:string, sound:string|boolean}|null}
 *   `null` means silent (no OS push).
 */
export function deliveryFor(row = {}) {
  const { type = "", severity, reference_type: ref = "" } = row;
  const isPush =
    PUSH_TYPES.has(type) ||
    PUSH_SEVERITIES.has(severity) ||
    ref === "incident";
  if (isPush) {
    return { kind: "push", channelId: CHANNEL.PUSH.id, sound: CHANNEL.PUSH.sound };
  }
  const isHeadsUp = HEADS_UP_TYPES.has(type) || HEADS_UP_SEVERITIES.has(severity);
  if (isHeadsUp) {
    return { kind: "heads-up", channelId: CHANNEL.HEADS_UP.id, sound: CHANNEL.HEADS_UP.sound };
  }
  return null;
}

async function activeTokensFor(employeeIds) {
  const ids = [...new Set((employeeIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT token FROM device_tokens WHERE employee_id = ANY($1) AND active = TRUE`,
    [ids]
  );
  return rows.map((r) => r.token);
}

/** Deactivate tokens Expo reports as no longer registered. */
async function deactivateInvalid(messages, tickets) {
  const invalid = [];
  (tickets || []).forEach((ticket, i) => {
    if (ticket?.details?.error === "DeviceNotRegistered" && messages[i]) {
      invalid.push(messages[i].to);
    }
  });
  if (!invalid.length) return;
  try {
    await query(`UPDATE device_tokens SET active = FALSE WHERE token = ANY($1)`, [invalid]);
  } catch (e) {
    console.warn("push token cleanup failed:", e?.message || e);
  }
}

/**
 * Send a real push to every active device token of `employeeIds`.
 * Best-effort and fire-and-forget by contract: never throws, never blocks the
 * caller's DB write.
 *
 * @returns {Array<object>} one result object per Expo batch
 */
export async function sendPush({ employeeIds, title, body, data = {}, channelId = CHANNEL.PUSH.id, sound = CHANNEL.PUSH.sound }) {
  try {
    const tokens = await activeTokensFor(employeeIds);
    if (!tokens.length) return [];

    const results = [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const messages = tokens.slice(i, i + BATCH_SIZE).map((token) => ({
        to: token,
        title,
        body,
        data,
        channelId,
        sound,
      }));

      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        results.push({ error: `Expo push HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` });
        continue;
      }
      const json = await res.json();
      await deactivateInvalid(messages, json?.data);
      results.push(json);
    }
    return results;
  } catch (e) {
    console.warn("sendPush failed:", e?.message || e);
    return [{ error: e?.message || "push send failed" }];
  }
}

/** True if any Expo ticket reports a delivered message. */
function delivered(results) {
  return (results || []).some((r) =>
    Array.isArray(r?.data) && r.data.some((t) => t?.status === "ok")
  );
}

/**
 * Deliver every pending `push_outbox` row (e.g. trigger-created notifications
 * that bypass the API routes). Sends each via `sendPush` on its own channel,
 * then marks the row `sent` and stamps the matching `notifications.pushed_at`
 * so the mobile feed knows the server already pushed. Best-effort: never
 * throws. Fire this after the caller's DB write that enqueued the rows.
 *
 * @param {object} [opts]
 * @param {number[]} [opts.employeeIds]  only flush pending rows for these employees
 * @returns {Promise<Array<object>>}
 */
export async function flushOutbox({ employeeIds } = {}) {
  try {
    const ids = [...new Set((employeeIds || []).map(Number).filter(Boolean))];
    let sql = `SELECT * FROM push_outbox WHERE status = 'pending' ORDER BY id`;
    const params = [];
    if (ids.length) {
      sql = `SELECT * FROM push_outbox WHERE status = 'pending' AND employee_id = ANY($1) ORDER BY id`;
      params.push(ids);
    }
    const { rows } = await query(sql, params);
    if (!rows.length) return [];

    const out = [];
    for (const row of rows) {
      const results = await sendPush({
        employeeIds: [row.employee_id],
        title: row.title,
        body: row.body,
        data: { reference_type: row.reference_type, reference_id: row.reference_id },
        channelId: row.channel_id,
      });
      const ok = delivered(results);
      try {
        if (ok) {
          await query(`UPDATE push_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
          await query(
            `UPDATE notifications SET pushed_at = now()
              WHERE employee_id = $1 AND reference_type = $2 AND reference_id = $3
                AND pushed_at IS NULL`,
            [row.employee_id, row.reference_type, row.reference_id]
          );
        } else {
          await query(
            `UPDATE push_outbox SET status = 'error', error = $2 WHERE id = $1`,
            [row.id, results[0]?.error || "no delivery"]
          );
        }
      } catch (e) {
        console.warn("push outbox update failed:", e?.message || e);
      }
      out.push({ id: row.id, delivered: ok, results });
    }
    return out;
  } catch (e) {
    console.warn("flushOutbox failed:", e?.message || e);
    return [{ error: e?.message || "outbox flush failed" }];
  }
}