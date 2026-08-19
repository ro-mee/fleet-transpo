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