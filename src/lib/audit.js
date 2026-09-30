import { getPool, withTransaction } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

const AUDIT_STATEMENT_TIMEOUT_MS = 1500;
const MAX_AUDIT_JSON_BYTES = 1024;
const MAX_USER_AGENT_LENGTH = 256;
const MAX_BEST_EFFORT_IN_FLIGHT = 2;
const RESERVED_POOL_CONNECTIONS = 2;
let bestEffortInFlight = 0;

const SAFE_KEYS = new Set([
  "action", "active", "all_devices", "approved", "attempts", "auto_authorized",
  "bytes", "channel", "changed_fields", "count", "decision", "decision_code",
  "delivered", "deleted_at", "delivery", "disabled", "dispatch_count", "duplicate",
  "enabled", "error_code", "event", "expires_in_days", "expires_in_minutes", "verification_cleared", "reinstated",
  "field", "fields", "forced", "from_status", "inspection_type", "inserted",
  "kind", "log_id", "method", "new_status", "old_status", "outcome", "page_size",
  "reason_code", "replaced", "resource", "result", "reviewed_ids", "scope", "side",
  "session_recorded", "source", "started", "started_duty", "status", "to_status",
  "trip_status", "type", "updated_fields", "verification_method", "vehicle_status",
  "fleet_status", "driver_status", "observed_at",
]);

const SAFE_ID_KEYS = new Set([
  "id", "employee_id", "driver_id", "vehicle_id", "trip_id", "route_id", "dispatch_id",
  "dispatch_schedule_id", "request_id", "reservation_id", "assignment_id", "location_id",
  "maintenance_id", "inspection_id", "expense_id", "fuel_request_id", "category_id",
  "document_id", "provider_id", "incident_id", "resource_id", "attendance_id",
  "leave_request_id", "target_ids", "driver_ids",
]);

const BLOCKED_KEY = /password|token|secret|credential|license|email|phone|address|image|photo|receipt|note|message|stack|latitude|longitude|geolocation|user.?agent|ip.?address/i;
const SAFE_CODE = /^[\p{L}\p{N} _.:/-]{1,128}$/u;

function isSafeKey(key) {
  return !BLOCKED_KEY.test(key) && (SAFE_KEYS.has(key) || SAFE_ID_KEYS.has(key) || key.endsWith("_id"));
}

function sanitizeValue(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    return SAFE_CODE.test(normalized) ? normalized : undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object" || depth >= 2) return undefined;

  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isSafeKey(key)) continue;
    const safe = sanitizeValue(child, depth + 1);
    if (safe !== undefined) clean[key] = safe;
  }
  return clean;
}

/** Strip sensitive/unbounded values from all audit payloads, including legacy call sites. */
export function sanitizeAuditValues(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Audit values must be an object");
  }
  const clean = sanitizeValue(value);
  if (!clean || Object.keys(clean).length === 0) return null;
  const serialized = JSON.stringify(clean);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AUDIT_JSON_BYTES) {
    throw new RangeError("Audit values exceed the 1 KiB limit");
  }
  return serialized;
}

function normalizeEntry(req, session, entry = {}) {
  const { action, resource, resourceId, oldValues, newValues } = entry;
  if (!action || !resource) throw new TypeError("Audit action and resource are required");

  const normalizedAction = String(action).trim();
  const normalizedResource = String(resource).trim();
  if (normalizedAction.length === 0 || normalizedAction.length > 50) throw new TypeError("Invalid audit action");
  if (normalizedResource.length === 0 || normalizedResource.length > 100) throw new TypeError("Invalid audit resource");

  const employeeId = Number(entry.employeeId ?? session?.user?.employeeId) || null;
  const id = resourceId == null ? null : Number(resourceId);
  if (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) throw new TypeError("Invalid audit employee ID");
  if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new TypeError("Invalid audit resource ID");

  const eventKey = entry.eventKey ?? null;
  if (eventKey !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventKey)) {
    throw new TypeError("Invalid audit event key");
  }

  return {
    employeeId,
    action: normalizedAction,
    resource: normalizedResource,
    resourceId: id,
    oldValues: sanitizeAuditValues(oldValues),
    newValues: sanitizeAuditValues(newValues),
    ip: req ? clientIp(req) : null,
    userAgent: req?.headers?.get?.("user-agent")?.slice(0, MAX_USER_AGENT_LENGTH) || null,
    eventKey,
  };
}

async function setAuditStatementTimeout(tx) {
  await tx.query("SELECT set_config('statement_timeout', $1, true)", [`${AUDIT_STATEMENT_TIMEOUT_MS}ms`]);
}

function reserveBestEffortSlot() {
  const pool = getPool();
  const maxConnections = Number(pool.options?.max) || 10;
  const activeConnections = Math.max(0, Number(pool.totalCount) - Number(pool.idleCount));
  if (bestEffortInFlight >= MAX_BEST_EFFORT_IN_FLIGHT
    || Number(pool.waitingCount) > 0
    || activeConnections >= maxConnections - RESERVED_POOL_CONNECTIONS) return false;
  bestEffortInFlight += 1;
  return true;
}

function normalizedInsertValues(normalized) {
  return [
    normalized.employeeId,
    normalized.action,
    normalized.resource,
    normalized.resourceId,
    normalized.oldValues,
    normalized.newValues,
    normalized.ip ? String(normalized.ip).slice(0, 50) : null,
    normalized.userAgent,
    normalized.eventKey,
  ];
}

/** Insert one audit entry inside the caller's transaction. Throws on failure. */
export async function writeAuditRequired(tx, req, session, entry = {}) {
  if (!tx || typeof tx.query !== "function") throw new TypeError("A transaction is required for this audit write");
  const normalized = normalizeEntry(req, session, entry);
  const startedAt = performance.now();
  await setAuditStatementTimeout(tx);

  const { rows } = await tx.query(
    `INSERT INTO audit_logs
       (employee_id, action, resource, resource_id, old_values, new_values, ip_address, user_agent, event_key)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
     ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
     RETURNING log_id, employee_id, action, resource`,
    normalizedInsertValues(normalized)
  );

  if (!rows[0] && normalized.eventKey) {
    const { rows: existing } = await tx.query(
      `SELECT (
         employee_id IS NOT DISTINCT FROM $2::integer
         AND action = $3
         AND resource = $4
         AND resource_id IS NOT DISTINCT FROM $5::integer
         AND old_values IS NOT DISTINCT FROM $6::jsonb
         AND new_values IS NOT DISTINCT FROM $7::jsonb
       ) AS same_event
         FROM audit_logs WHERE event_key = $1 LIMIT 1`,
      [normalized.eventKey, normalized.employeeId, normalized.action, normalized.resource, normalized.resourceId, normalized.oldValues, normalized.newValues]
    );
    if (!existing[0]?.same_event) {
      throw new Error("Audit event key is already bound to a different event");
    }
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs >= 250) {
    console.warn(JSON.stringify({ event: "audit_write_slow", action: normalized.action, resource: normalized.resource, elapsed_ms: elapsedMs }));
  }
  return rows[0] ?? { duplicate: true };
}

/** Insert a small replay batch using one SQL insert inside the caller's transaction. */
export async function writeAuditBatchRequired(tx, req, session, entries = []) {
  if (!tx || typeof tx.query !== "function") throw new TypeError("A transaction is required for this audit write");
  if (!Array.isArray(entries) || entries.length > 20) throw new RangeError("Audit batch must contain at most 20 events");
  if (entries.length === 0) return { inserted: 0 };

  const normalized = entries.map((entry) => normalizeEntry(req, session, entry));
  const keys = normalized.map((entry) => entry.eventKey);
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    throw new TypeError("Audit replay events require unique event keys");
  }

  const rowsToInsert = normalized.map((entry) => ({
    employee_id: entry.employeeId,
    action: entry.action,
    resource: entry.resource,
    resource_id: entry.resourceId,
    old_values: entry.oldValues ? JSON.parse(entry.oldValues) : null,
    new_values: entry.newValues ? JSON.parse(entry.newValues) : null,
    ip_address: entry.ip ? String(entry.ip).slice(0, 50) : null,
    user_agent: entry.userAgent,
    event_key: entry.eventKey,
  }));
  const startedAt = performance.now();
  await setAuditStatementTimeout(tx);
  const { rows: inserted } = await tx.query(
    `INSERT INTO audit_logs
       (employee_id, action, resource, resource_id, old_values, new_values, ip_address, user_agent, event_key)
     SELECT x.employee_id, x.action, x.resource, x.resource_id, x.old_values, x.new_values,
            x.ip_address, x.user_agent, x.event_key
       FROM jsonb_to_recordset($1::jsonb) AS x(
         employee_id integer, action text, resource text, resource_id integer,
         old_values jsonb, new_values jsonb, ip_address varchar(50), user_agent text, event_key uuid
       )
     ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
     RETURNING event_key`,
    [JSON.stringify(rowsToInsert)]
  );
  const { rows: existing } = await tx.query(
    `SELECT a.event_key,
            (a.employee_id IS NOT DISTINCT FROM x.employee_id
             AND a.action = x.action
             AND a.resource = x.resource
             AND a.resource_id IS NOT DISTINCT FROM x.resource_id
             AND a.old_values IS NOT DISTINCT FROM x.old_values
             AND a.new_values IS NOT DISTINCT FROM x.new_values) AS same_event
       FROM audit_logs a
       JOIN jsonb_to_recordset($1::jsonb) AS x(
         employee_id integer, action text, resource text, resource_id integer,
         old_values jsonb, new_values jsonb, ip_address varchar(50), user_agent text, event_key uuid
       ) ON x.event_key = a.event_key`,
    [JSON.stringify(rowsToInsert)]
  );
  if (existing.length !== keys.length || existing.some((row) => !row.same_event)) throw new Error("Audit event key is already bound to a different event");

  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs >= 250) {
    console.warn(JSON.stringify({ event: "audit_batch_write_slow", count: entries.length, elapsed_ms: elapsedMs }));
  }
  return { inserted: inserted.length, duplicates: entries.length - inserted.length };
}

/**
 * @param {Request} req      The incoming request (for IP + user-agent).
 * @param {object}  session  The session returned by requireAuth (may be null).
 * @param {object}  entry
 * @param {string}  entry.action      e.g. "create" | "update" | "delete" | "login"
 * @param {string}  entry.resource    logical resource name, e.g. "vehicles"
 * @param {number}  [entry.resourceId]
 * @param {object}  [entry.oldValues]
 * @param {object}  [entry.newValues]
 * @param {number}  [entry.employeeId] override actor (e.g. login before session exists)
 */
export async function writeAudit(req, session, entry = {}) {
  const startedAt = performance.now();
  let reserved = false;
  try {
    reserved = reserveBestEffortSlot();
    if (!reserved) {
      console.warn(JSON.stringify({
        event: "audit_write_dropped_overload",
        action: String(entry?.action || "unknown").slice(0, 50),
        resource: String(entry?.resource || "unknown").slice(0, 100),
      }));
      return null;
    }
    return await withTransaction((tx) => writeAuditRequired(tx, req, session, entry));
  } catch (e) {
    // Legacy and lower-risk events stay best-effort; report a sanitized signal
    // outside the database so outages cannot hide failed audit writes.
    console.error(JSON.stringify({
      event: "audit_write_failed",
      action: String(entry?.action || "unknown").slice(0, 50),
      resource: String(entry?.resource || "unknown").slice(0, 100),
      code: String(e?.code || e?.name || "UNKNOWN").slice(0, 40),
      elapsed_ms: Math.round(performance.now() - startedAt),
    }));
    return null;
  } finally {
    if (reserved) bestEffortInFlight = Math.max(0, bestEffortInFlight - 1);
  }
}
