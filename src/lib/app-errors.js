// Centralized unexpected-failure log (app_errors) — Pass 1a foundation.
//
// Ownership rule (the whole point of this module):
//   app_errors owns UNEXPECTED application/platform failures.
//   Specialized subsystems own their expected operational failures
//   (AI provider/timeout/parse/quota → ailogs, etc.).
//
// The gate is proof-of-persistence, NOT error codes or route prefixes:
//   - subsystemOwned === true  → skip app_errors. The owning subsystem sets
//     this marker ONLY AFTER its own specialized write succeeded.
//   - anything else (including a known SUBSYSTEM_OWNED_CODES code WITHOUT the
//     marker, e.g. because the specialized write itself failed) → capture in
//     app_errors as fallback. An error is never lost merely because its code
//     claims another subsystem.
//
// INVARIANTS:
//   - Every export here is best-effort and NEVER throws. Logging must not
//     break the request it observes (a logging DB failure still returns the
//     original 500 — see handleError in lib/api/utils.js).
//   - No request/response bodies are persisted. Message/stack are sanitized
//     (secrets redacted) and truncated before insert.
//   - No FK to employees: a log write must never fail on referential
//     integrity (e.g. a just-deleted account).
//   - No imports from lib/api/utils.js (that module imports this one for
//     handleError — keep the edge one-directional).

import { query } from "@/lib/db";

export const APP_ERROR_SOURCES = new Set(["server", "web", "mobile"]);

// Classification ONLY. Membership here does not prove the specialized log
// was persisted, so it never alone suppresses an app_errors row.
export const SUBSYSTEM_OWNED_CODES = new Set([
  "AI_PROVIDER_ERROR",
  "AI_RATE_LIMIT",
  "AI_TIMEOUT",
  "AI_PARSE_FAILURE",
  "AI_GENERATION_FAILURE",
]);

const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;
const MAX_ROUTE = 300;
const MAX_USER_AGENT = 300;
const MAX_FINGERPRINT = 400;

const SENSITIVE_PATTERNS = [
  // Bearer tokens: "Bearer abc.def.ghi" (not the bare word).
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}/g, sub: "Bearer [redacted]" },
  // Authorization / Cookie header lines (multiline stacks included).
  { re: /^.*\bauthorization\s*:\s*.+$/gim, sub: "Authorization: [redacted]" },
  { re: /^.*\bcookie\s*:\s*.+$/gim, sub: "Cookie: [redacted]" },
  // Absolute URLs → origin + pathname (query/fragment carry the secrets).
  // Falls back to [url] when the match is not parseable.
  {
    re: /https?:\/\/[^\s"'`()]+/g,
    sub: (m) => {
      try {
        const u = new URL(m);
        return u.origin + u.pathname;
      } catch {
        return "[url]";
      }
    },
  },
  // Standalone secret query params outside a full URL (?token=abc&…).
  {
    re: /([?&](?:token|access_token|refresh_token|id_token|api_?key|secret|client_secret|password|passwd|pwd|auth|session(?:id|_token)?)=)[^&\s"'`()]+/gi,
    sub: "$1[redacted]",
  },
  // Obvious secret assignments: password=…, "secret": "…". Requires : or =
  // after the key so prose ("password is required") is untouched.
  {
    re: /(['"]?(?:password|passwd|pwd|secret|client_secret|api_?key)['"]?\s*[:=]\s*)['"]?[^\s,'"`()}\]]+/gi,
    sub: "$1[redacted]",
  },
];

/** Redact secrets from free text. Pure. Never throws. */
export function sanitizeErrorText(text) {
  try {
    let out = String(text ?? "");
    for (const { re, sub } of SENSITIVE_PATTERNS) {
      re.lastIndex = 0;
      out = out.replace(re, sub);
    }
    return out;
  } catch {
    return "[unsanitizable]";
  }
}

function truncate(text, max) {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max) : s;
}

/** Normalize a message so repeated failures share one fingerprint. Pure. */
export function normalizeErrorMessage(message) {
  try {
    return String(message ?? "unknown error")
      .toLowerCase()
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
      .replace(/\b\d+\b/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "unknown error";
  } catch {
    return "unknown error";
  }
}

/** Stable grouping key: source|route|normalized-message. Pure. */
export function fingerprintError({ source, route, message } = {}) {
  try {
    const src = APP_ERROR_SOURCES.has(source) ? source : "server";
    const fp = `${src}|${route || "unknown-route"}|${normalizeErrorMessage(message)}`;
    return fp.length > MAX_FINGERPRINT ? fp.slice(0, MAX_FINGERPRINT) : fp;
  } catch {
    return "server|unknown-route|unknown error";
  }
}

/**
 * Mark an error as owned by a specialized subsystem. Call ONLY AFTER that
 * subsystem's own log write succeeded — the marker is proof of persistence,
 * and shouldWriteAppError treats it as such. Returns the error for chaining.
 */
export function markSubsystemOwned(error, code) {
  try {
    if (error && typeof error === "object") {
      error.subsystemOwned = true;
      if (code) error.code = code;
    }
  } catch {
    // Marking must never break the throw path.
  }
  return error;
}

/**
 * The ownership gate. False ONLY on proof of persistence
 * (subsystemOwned === true). A known subsystem code WITHOUT the marker —
 * e.g. the specialized write failed — still returns true so app_errors
 * captures it as fallback. Never throws.
 */
export function shouldWriteAppError(error) {
  try {
    if (error?.subsystemOwned === true) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Backward-compatible context normalizer for handleError's second arg.
 * String (the 11 existing "Failed to X" labels) → { operation }.
 * Object ({ req, employeeId, ... }) → as-is. Anything else → {}.
 * Pure. Never throws.
 */
export function normalizeContext(context) {
  try {
    if (!context) return {};
    if (typeof context === "string") return { operation: context };
    if (typeof context === "object") return context;
    return {};
  } catch {
    return {};
  }
}

/**
 * Best-effort route + user-agent from a Request/NextRequest WITHOUT running
 * authentication (the logger must never cause secondary auth/DB failures).
 * Stores the pathname, never the full URL. Pure-ish (reads only). Never throws.
 */
export function requestContext(req) {
  try {
    const out = {};
    const rawUrl = typeof req?.url === "string" ? req.url : "";
    if (rawUrl) {
      try {
        const pathname = new URL(rawUrl, "http://local").pathname || "";
        if (pathname && pathname !== "/") out.route = truncate(pathname, MAX_ROUTE);
      } catch {
        // Unparseable URL — route stays unknown (null), never invented.
      }
    }
    const headers = req?.headers;
    const ua =
      typeof headers?.get === "function"
        ? headers.get("user-agent")
        : headers?.["user-agent"] ?? headers?.["User-Agent"];
    if (typeof ua === "string" && ua) out.userAgent = truncate(ua, MAX_USER_AGENT);
    return out;
  } catch {
    return {};
  }
}

/**
 * Persist one unexpected failure. Best-effort: resolves { error_id } on
 * success, null when the insert fails. NEVER throws and NEVER rejects —
 * `void writeAppError(...)` is safe anywhere, including handleError.
 */
export async function writeAppError({
  source = "server",
  route = null,
  message = "",
  stack = null,
  statusCode = null,
  employeeId = null,
  userAgent = null,
} = {}) {
  try {
    const src = APP_ERROR_SOURCES.has(source) ? source : "server";
    const cleanMessage = truncate(sanitizeErrorText(message) || "unknown error", MAX_MESSAGE);
    const cleanStack = stack ? truncate(sanitizeErrorText(stack), MAX_STACK) : null;
    const cleanRoute = route ? truncate(String(route), MAX_ROUTE) : null;
    const fp = fingerprintError({ source: src, route: cleanRoute, message: cleanMessage });
    const emp =
      employeeId === null || employeeId === undefined || Number.isNaN(Number(employeeId))
        ? null
        : Number(employeeId);
    const { rows } = await query(
      `INSERT INTO app_errors
         (source, route, message, stack, status_code, employee_id, fingerprint, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING error_id`,
      [
        src,
        cleanRoute,
        cleanMessage,
        cleanStack,
        statusCode ?? null,
        emp,
        fp,
        userAgent ? truncate(String(userAgent), MAX_USER_AGENT) : null,
      ]
    );
    return { error_id: rows[0]?.error_id ?? null };
  } catch {
    return null;
  }
}

/**
 * Delete rows older than the retention window (default 90 days). Called from
 * the CRON_SECRET-protected scheduled flow in its own try/catch so pruning
 * can never fail the vehicle/driver/compliance sync. Resolves { deleted };
 * NEVER throws.
 */
export async function pruneAppErrors({ olderThanDays = 90 } = {}) {
  try {
    const days = Math.min(Math.max(Number(olderThanDays) || 90, 1), 3650);
    const { rowCount } = await query(
      `DELETE FROM app_errors WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [String(days)]
    );
    return { deleted: rowCount ?? 0 };
  } catch {
    return { deleted: 0 };
  }
}
