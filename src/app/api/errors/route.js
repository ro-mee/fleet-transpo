import { query } from "@/lib/db";
import {
  requireAuth,
  requirePermission,
  parseBody,
  ok,
  err,
  errValidation,
  handleError,
} from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAppError } from "@/lib/app-errors";

/**
 * /api/errors — central unexpected-failure log (app_errors).
 *
 * POST: authenticated client crash reports (web ErrorBoundary, mobile
 *   ErrorBoundary). Server-side code never POSTs here — it calls
 *   writeAppError directly (see handleError in lib/api/utils.js).
 * GET: system_admin event + occurrence-group reads for System Health.
 *
 * Ownership (see lib/app-errors.js): this endpoint only receives failures
 * with no owning subsystem. AI provider/timeout/parse/quota events belong
 * in ailogs; a `source` of "server" is rejected here for the same reason.
 */

// All six current roles — drivers especially must be able to report mobile
// crashes. The repo default requireAuth() roles deliberately exclude driver,
// so an explicit array is required (and satisfies verify-route-auth, which
// rejects bare requireAuth on mutating handlers).
const REPORT_ROLES = [
  "system_admin",
  "admin",
  "fleet_manager",
  "dispatcher",
  "management",
  "driver",
];

const CLIENT_SOURCES = new Set(["web", "mobile"]);

// Hard cap on the raw payload so a runaway client cannot stuff the endpoint
// (field-level maxLength checks below give friendly 400s under this).
const MAX_BODY_BYTES = 12000;

/** Pathname only — never store a full URL. Returns null when unusable. */
function normalizeRoute(route) {
  if (route === undefined || route === null) return null;
  const raw = String(route).trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname || null;
  } catch {
    return null;
  }
  const path = raw.split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : null;
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, REPORT_ROLES);
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return err("Error report must be a JSON object.", 400);
    }
    if (JSON.stringify(body).length > MAX_BODY_BYTES) {
      return err("Error report too large.", 413);
    }

    const errors = validateBody(body, {
      source: {
        required: true,
        pattern: /^(web|mobile)$/,
        message: "Source must be web or mobile.",
        label: "Source",
      },
      message: { required: true, maxLength: 2000, label: "Message" },
      route: { maxLength: 300, label: "Route" },
      stack: { maxLength: 8000, label: "Stack" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const route = normalizeRoute(body.route);
    if (body.route && !route) {
      return err("Route must be a path (e.g. /dashboard).", 400);
    }

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`error-report:ip:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }),
      rateLimit(`error-report:account:${session.user.employeeId ?? "none"}`, {
        limit: 20,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    // Identity always comes from the session — never the body.
    const result = await writeAppError({
      source: body.source,
      route,
      message: body.message,
      stack: body.stack || null,
      statusCode: null,
      employeeId: session.user.employeeId ?? null,
      userAgent:
        typeof req.headers?.get === "function" ? req.headers.get("user-agent") : null,
    });
    // Always 200: the reporter is already in a failure path — a 500 here
    // could trigger client retry loops. `received` tells the truth.
    return ok({ received: result !== null, error_id: result?.error_id ?? null });
  } catch (e) {
    return handleError(e);
  }
}

function parseWindow(sp) {
  const out = {};
  for (const key of ["from", "to"]) {
    const raw = sp.get(key);
    if (!raw) continue;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return { error: `Invalid ${key} date. Use ISO format.` };
    out[key] = new Date(t).toISOString();
  }
  return out;
}

/**
 * GET /api/errors
 *
 * Restricted to audit-read (system_admin) — rows carry reporter identity,
 * user agents, and raw failure text.
 *
 * Query params: source (web|mobile|server), fingerprint (exact),
 *   from, to (ISO), error_id (single-row detail WITH stack),
 *   limit (max 500), offset.
 * List rows OMIT stack (up to 4KB each); fetch one error_id for the full
 * stack. Response: { events, groups, total, limit, offset } where groups
 * are per-fingerprint occurrences ordered by last_seen DESC.
 */
export async function GET(req) {
  try {
    await requirePermission(req, "audit", "read");
    const sp = new URL(req.url).searchParams;

    const errorIdRaw = sp.get("error_id");
    if (errorIdRaw) {
      const id = Number(errorIdRaw);
      if (!Number.isInteger(id) || id <= 0) return err("Invalid error_id.", 400);
      const { rows } = await query(
        `SELECT a.error_id, a.source, a.route, a.message, a.stack, a.status_code,
                a.employee_id, e.email AS reporter_email, a.fingerprint,
                a.user_agent, a.created_at
           FROM app_errors a
           LEFT JOIN employees e ON e.employee_id = a.employee_id
          WHERE a.error_id = $1`,
        [id]
      );
      if (!rows.length) return err("Error event not found.", 404);
      return ok({ event: rows[0] });
    }

    const params = [];
    let idx = 1;
    const conditions = [];

    const source = sp.get("source");
    if (source) {
      if (!CLIENT_SOURCES.has(source) && source !== "server") {
        return err("Invalid source. Use web, mobile, or server.", 400);
      }
      conditions.push(`a.source = $${idx++}`);
      params.push(source);
    }

    const fingerprint = sp.get("fingerprint");
    if (fingerprint) {
      conditions.push(`a.fingerprint = $${idx++}`);
      params.push(fingerprint);
    }

    const window = parseWindow(sp);
    if (window.error) return err(window.error, 400);
    if (window.from) {
      conditions.push(`a.created_at >= $${idx++}`);
      params.push(window.from);
    }
    if (window.to) {
      conditions.push(`a.created_at <= $${idx++}`);
      params.push(window.to);
    }

    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "200", 10) || 200, 1), 500);
    const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: events } = await query(
      `SELECT a.error_id, a.source, a.route, a.message, a.status_code,
              a.employee_id, e.email AS reporter_email, a.fingerprint,
              a.user_agent, a.created_at,
              (a.stack IS NOT NULL) AS has_stack
         FROM app_errors a
         LEFT JOIN employees e ON e.employee_id = a.employee_id
        ${where}
        ORDER BY a.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM app_errors a ${where}`,
      params
    );

    // NOTE: own placeholder numbering — idx already advanced past the
    // events limit/offset, so this query numbers from params.length.
    const { rows: groups } = await query(
      `SELECT a.fingerprint,
              COUNT(*)::int AS occurrences,
              MIN(a.created_at) AS first_seen,
              MAX(a.created_at) AS last_seen,
              (array_agg(a.message ORDER BY a.created_at DESC))[1] AS sample
         FROM app_errors a
        ${where}
        GROUP BY a.fingerprint
        ORDER BY last_seen DESC LIMIT $${params.length + 1}`,
      [...params, Math.min(limit, 200)]
    );

    return ok({
      events,
      groups,
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (e) {
    return handleError(e);
  }
}
