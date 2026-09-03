import { query } from "@/lib/db";
import { getLocationFromIp } from "./geoip";

export const WEB_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const IDLE_TIMEOUT_SECONDS = 60 * 60; // 1 hour idle timeout
export const IDLE_WARNING_SECONDS = 5 * 60; // 5 minutes before idle timeout
export const ABSOLUTE_WARNING_SECONDS = 5 * 60; // 5 minutes before absolute expiry

export async function revokeEmployeeSessions(tx, employeeId) {
  await tx.query(
    `UPDATE web_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE employee_id = $1 AND revoked_at IS NULL`,
    [employeeId]
  );
  await tx.query(
    `UPDATE mobile_refresh_tokens
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE employee_id = $1 AND revoked_at IS NULL`,
    [employeeId]
  );
}

export function sessionDeviceLabel(userAgent, kind = "web") {
  if (kind === "mobile") return "FleetOps Driver app";
  const ua = String(userAgent || "");
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("Chrome/")
      ? "Chrome"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Safari/") && !ua.includes("Chrome/")
          ? "Safari"
          : ua.includes("OPR/")
            ? "Opera"
            : "Browser";
  const os = ua.includes("Windows")
    ? "Windows"
    : ua.includes("Mac OS")
      ? "macOS"
      : ua.includes("Android")
        ? "Android"
        : ua.includes("iPhone") || ua.includes("iPad")
          ? "iOS"
          : ua.includes("Linux")
            ? "Linux"
            : "device";
  return `${browser} on ${os}`;
}

export function maskIp(ip) {
  if (!ip) return null;
  const value = String(ip);
  if (value.includes(".")) {
    const parts = value.split(".");
    return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.x` : "Hidden";
  }
  return `${value.slice(0, 8)}…`;
}

export function sessionDto(row, kind, currentUser = null) {
  const id = kind === "web" ? row.session_id : row.family_id;
  const is_current = kind === "web" 
    ? String(id) === String(currentUser?.sessionId || "")
    : String(id) === String(currentUser?.familyId || "");

  return {
    id: String(id),
    kind,
    device: sessionDeviceLabel(row.user_agent, kind),
    ipAddress: maskIp(row.ip_address),
    createdAt: row.created_at,
    lastActiveAt: row.last_seen_at || row.last_used_at || row.created_at,
    expiresAt: row.expires_at,
    location: getLocationFromIp(row.ip_address),
    is_current,
    current: is_current // Backwards compatibility for existing web UI
  };
}

export async function listEmployeeSessions(employeeId, currentUser) {
  const [web, mobile] = await Promise.all([
    query(
      `SELECT session_id, created_at, last_seen_at, expires_at, ip_address, user_agent
         FROM web_sessions
        WHERE employee_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
        ORDER BY last_seen_at DESC`,
      [employeeId]
    ),
    query(
      `SELECT family_id,
              MIN(created_at) AS created_at,
              MAX(COALESCE(last_used_at, created_at)) AS last_used_at,
              MAX(expires_at) AS expires_at,
              (ARRAY_AGG(ip_address ORDER BY COALESCE(last_used_at, created_at) DESC))[1] AS ip_address,
              (ARRAY_AGG(user_agent ORDER BY COALESCE(last_used_at, created_at) DESC))[1] AS user_agent
         FROM mobile_refresh_tokens
        WHERE employee_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
        GROUP BY family_id
        ORDER BY MAX(COALESCE(last_used_at, created_at)) DESC`,
      [employeeId]
    ),
  ]);

  const sessions = [
    ...web.rows.map((row) => sessionDto(row, "web", currentUser)),
    ...mobile.rows.map((row) => sessionDto(row, "mobile", currentUser)),
  ];

  // Sort: current first, then by lastActiveAt descending
  return sessions.sort((a, b) => {
    if (a.is_current && !b.is_current) return -1;
    if (!a.is_current && b.is_current) return 1;
    return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
  });
}
