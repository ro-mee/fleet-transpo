import { query, withTransaction } from "@/lib/db";
import { AuthError, requireDriver, handleError } from "@/lib/api/utils";
import { writeAuditRequired, writeAuditBatchRequired } from "@/lib/audit";
import { maskLicenseNumber } from "@/lib/drivers/license-eligibility";
import { rateLimit } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPLAY = 20;
const REPLAY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function consumeViewBudget(employeeId, count = 1) {
  const [minute, day] = await Promise.all([
    rateLimit(`license-view:self:minute:${employeeId}`, { limit: 10, windowMs: 60_000, cost: count }),
    rateLimit(`license-view:self:day:${employeeId}`, { limit: 60, windowMs: 86_400_000, cost: count }),
  ]);
  if (!minute.allowed || !day.allowed) throw new AuthError("License view limit reached. Try again later.", 429, "RATE_LIMITED");
}

export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const eventKey = new URL(req.url).searchParams.get("event_key");
    if (!UUID.test(eventKey || "")) throw new AuthError("A valid event_key is required", 400, "BAD_REQUEST");
    await consumeViewBudget(session.user.employeeId);

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT driver_id, license_number FROM drivers WHERE driver_id = $1 AND employee_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [session.user.driverId, session.user.employeeId]
      );
      const driver = rows[0];
      if (!driver) throw new AuthError("No driver record is linked to this account", 403);
      await writeAuditRequired(tx, req, session, {
        action: "license_masked_viewed",
        resource: "drivers",
        resourceId: driver.driver_id,
        eventKey,
        newValues: { driver_ids: [driver.driver_id], source: "self_license_screen", count: 1 },
      });
      return { driver_id: driver.driver_id, license_number: maskLicenseNumber(driver.license_number) };
    });
    return Response.json({ license: result });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AuthError("Request is too large", 413, "PAYLOAD_TOO_LARGE");
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new AuthError("Request is too large", 413, "PAYLOAD_TOO_LARGE");
    let body;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { throw new AuthError("Invalid JSON body", 400, "BAD_REQUEST"); }

    const events = body.events;
    if (!Array.isArray(events) || events.length < 1 || events.length > MAX_REPLAY) {
      throw new AuthError(`events must contain 1 to ${MAX_REPLAY} items`, 400, "BAD_REQUEST");
    }
    const seen = new Set();
    const now = Date.now();
    for (const event of events) {
      const observedAt = Date.parse(event?.observed_at);
      if (!UUID.test(event?.event_key || "") || seen.has(event.event_key)) throw new AuthError("Each event requires a unique valid event_key", 400, "BAD_REQUEST");
      seen.add(event.event_key);
      if (Number(event.driver_id) !== Number(session.user.driverId)) throw new AuthError("Replay event does not belong to this driver", 403);
      if (!Number.isFinite(observedAt) || observedAt < now - REPLAY_MAX_AGE_MS || observedAt > now + 5 * 60_000) {
        throw new AuthError("Replay event time is outside the accepted range", 400, "BAD_REQUEST");
      }
    }

    const keys = [...seen];
    const { rows: priorRows } = await query(
      `SELECT event_key, employee_id, action, resource, resource_id, new_values
         FROM audit_logs WHERE event_key = ANY($1::uuid[])`,
      [keys]
    );
    for (const prior of priorRows) {
      const priorIds = prior.new_values?.driver_ids;
      if (Number(prior.employee_id) !== Number(session.user.employeeId)
        || prior.action !== "license_masked_viewed"
        || prior.resource !== "drivers"
        || Number(prior.resource_id) !== Number(session.user.driverId)
        || prior.new_values?.source !== "client_offline"
        || Number(prior.new_values?.count) !== 1
        || prior.new_values?.observed_at !== events.find((event) => event.event_key === prior.event_key)?.observed_at
        || !Array.isArray(priorIds)
        || priorIds.length !== 1
        || Number(priorIds[0]) !== Number(session.user.driverId)) {
        throw new AuthError("An event key is already bound to another action", 409, "EVENT_KEY_CONFLICT");
      }
    }
    const existing = new Set(priorRows.map((row) => row.event_key));
    const fresh = events.filter((event) => !existing.has(event.event_key));
    if (fresh.length) await consumeViewBudget(session.user.employeeId, fresh.length);

    const result = await withTransaction(async (tx) => writeAuditBatchRequired(
      tx,
      req,
      session,
      fresh.map((event) => ({
        action: "license_masked_viewed",
        resource: "drivers",
        resourceId: session.user.driverId,
        eventKey: event.event_key,
        newValues: { driver_ids: [session.user.driverId], source: "client_offline", observed_at: event.observed_at, count: 1 },
      }))
    ));
    return Response.json({ accepted: result.inserted, duplicates: events.length - result.inserted });
  } catch (error) {
    return handleError(error);
  }
}
