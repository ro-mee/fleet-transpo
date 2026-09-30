import { query } from "@/lib/db";
import { AuthError, requireAuth, requirePermission, ok, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_DATE_SPAN_MS = 366 * 24 * 60 * 60 * 1000;
const TAXONOMY_TTL_MS = 5 * 60 * 1000;

let taxonomyCache = { expiresAt: 0, actions: [], resources: [] };

function invalid(message) {
  return new AuthError(message, 400, "BAD_REQUEST");
}

function parseEnum(value, label) {
  if (!value) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) throw invalid(`Invalid ${label}`);
  return value;
}

function parseDateBoundary(value, isEnd) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid("Invalid date filter");
    if (isEnd) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid("Invalid date filter");
  return date.toISOString();
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(decoded?.createdAt);
    const logId = Number(decoded?.logId);
    if (Number.isNaN(createdAt.getTime()) || !Number.isSafeInteger(logId) || logId <= 0) throw new Error();
    return { createdAt: createdAt.toISOString(), logId };
  } catch {
    throw invalid("Invalid audit cursor");
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({
    createdAt: new Date(row.created_at).toISOString(),
    logId: Number(row.log_id),
  })).toString("base64url");
}

async function getTaxonomy() {
  if (taxonomyCache.expiresAt > Date.now()) return taxonomyCache;
  const { rows } = await query(
    `SELECT 'action' AS kind, action AS value FROM audit_logs GROUP BY action
     UNION ALL
     SELECT 'resource' AS kind, resource AS value FROM audit_logs GROUP BY resource
     ORDER BY kind, value`
  );
  taxonomyCache = {
    expiresAt: Date.now() + TAXONOMY_TTL_MS,
    actions: rows.filter((row) => row.kind === "action").map((row) => row.value),
    resources: rows.filter((row) => row.kind === "resource").map((row) => row.value),
  };
  return taxonomyCache;
}

export async function GET(req) {
  let session = null;
  try {
    session = await requirePermission(req, "audit", "read");
    const sp = new URL(req.url).searchParams;
    const action = parseEnum(sp.get("action"), "action");
    const resource = parseEnum(sp.get("resource"), "resource");
    const from = parseDateBoundary(sp.get("from"), false);
    const to = parseDateBoundary(sp.get("to"), true);
    const employeeRaw = sp.get("employee_id");
    const employeeId = employeeRaw == null || employeeRaw === "" ? null : Number(employeeRaw);
    if (employeeId != null && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) throw invalid("Invalid employee filter");

    if (from && to) {
      const span = new Date(to).getTime() - new Date(from).getTime();
      if (span < 0 || span > MAX_DATE_SPAN_MS) throw invalid("Date range must be within 366 days");
    }

    const rawLimit = sp.get("limit");
    const limit = rawLimit == null ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid(`limit must be between 1 and ${MAX_LIMIT}`);
    const cursor = decodeCursor(sp.get("cursor"));

    const params = [];
    const conditions = [];
    let idx = 1;
    const add = (sql, value) => {
      conditions.push(sql.replace("?", `$${idx++}`));
      params.push(value);
    };
    if (action) add("a.action = ?", action);
    if (resource) add("a.resource = ?", resource);
    if (from) add("a.created_at >= ?::timestamptz", from);
    if (to) add("a.created_at < ?::timestamptz", to);
    if (employeeId != null) add("a.employee_id = ?", employeeId);
    if (cursor) {
      const timestampIndex = idx++;
      const logIdIndex = idx++;
      conditions.push(`(a.created_at < $${timestampIndex}::timestamptz OR (a.created_at = $${timestampIndex}::timestamptz AND a.log_id < $${logIdIndex}))`);
      params.push(cursor.createdAt, cursor.logId);
    }

    let sql = `SELECT a.log_id, a.employee_id, e.first_name, e.last_name, e.email,
                      a.action, a.resource, a.resource_id, a.ip_address, a.created_at
                 FROM audit_logs a
                 LEFT JOIN employees e ON e.employee_id = a.employee_id`;
    if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
    sql += ` ORDER BY a.created_at DESC, a.log_id DESC LIMIT $${idx}`;
    params.push(limit + 1);

    const [{ rows }, taxonomy] = await Promise.all([
      query(sql, params),
      getTaxonomy().catch(() => ({ actions: [], resources: [] })),
    ]);
    const hasMore = rows.length > limit;
    const logs = rows.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor(logs[logs.length - 1]) : null;

    await writeAudit(req, session, {
      action: "audit_viewed",
      resource: "audit_logs",
      newValues: { scope: "list", action, resource, employee_id: employeeId, count: logs.length },
    });

    return ok({ logs, hasMore, nextCursor, limit, actions: taxonomy.actions, resources: taxonomy.resources });
  } catch (e) {
    if (e?.status === 403) {
      const deniedSession = session || await requireAuth(req, ["*"]).catch(() => null);
      if (deniedSession) {
        await writeAudit(req, deniedSession, {
          action: "sensitive_access_denied",
          resource: "audit_logs",
          newValues: { reason_code: "permission_denied", scope: "list" },
        });
      }
    }
    return handleError(e);
  }
}
