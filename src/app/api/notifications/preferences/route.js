import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS } from "@/lib/constants";

const CHANNELS = Object.values(NOTIFICATION_CHANNELS);

export async function GET(req) {
  try {
    const session = await requireAuth(req, [
      "system_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
      "driver",
    ]);
    const employeeId = session.user?.employeeId ?? null;

    const preferences = {};
    const toggled = {};
    if (employeeId) {
      const { rows } = await query(
        `SELECT event_key, channel, enabled FROM notification_preferences WHERE employee_id = $1`,
        [employeeId]
      );
      for (const row of rows) {
        toggled[`${row.event_key}:${row.channel}`] = row.enabled;
      }
    }

    for (const [event, config] of Object.entries(NOTIFICATION_EVENTS)) {
      preferences[event] = {};
      for (const channel of CHANNELS) {
        const k = `${event}:${channel}`;
        preferences[event][channel] = k in toggled ? toggled[k] : Boolean(config.defaults[channel]);
      }
    }

    return ok({ preferences, employee_id: employeeId });
  } catch (e) { return handleError(e); }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, [
      "system_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
      "driver",
    ]);
    if (session.user?.employeeId == null) {
      return err("No employee profile is linked to this account", 400);
    }
    const body = await parseBody(req);
    const { event_key, channel, enabled } = body || {};

    if (!(event_key in NOTIFICATION_EVENTS)) {
      return err(`Unknown notification event: ${event_key}`, 400);
    }
    if (!CHANNELS.includes(channel)) {
      return err(`Unknown channel: ${channel}`, 400);
    }
    if (typeof enabled !== "boolean") {
      return err("enabled must be a boolean", 400);
    }

    await query(
      `INSERT INTO notification_preferences (employee_id, event_key, channel, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (employee_id, event_key, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [session.user.employeeId, event_key, channel, enabled]
    );

    return ok({ event_key, channel, enabled });
  } catch (e) { return handleError(e); }
}