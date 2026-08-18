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

// Mirrors the mobile tier rule (mobile/lib/notifications/tiers.js): only the
// rows that would earn an OS-level surface get a real push. Kept here so the
// server decides before sending rather than shipping every row.
const PUSH_TYPES = new Set(["Alert", "Emergency"]);
const PUSH_SEVERITIES = new Set(["Critical", "Major"]);

/** @param {object} row  a notifications row (type, severity, reference_type) */
export function shouldPush(row = {}) {
  const { type = "", severity, reference_type: ref = "" } = row;
  if (PUSH_TYPES.has(type)) return true;
  if (ref === "incident" && PUSH_SEVERITIES.has(severity)) return true;
  if (PUSH_SEVERITIES.has(severity)) return true;
  return false;
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
export async function sendPush({ employeeIds, title, body, data = {} }) {
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
        sound: "default",
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