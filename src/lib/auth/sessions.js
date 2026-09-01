import { query } from "@/lib/db";

export const WEB_SESSION_TTL_SECONDS = 12 * 60 * 60;

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

export function sessionDto(row, kind, currentSessionId = null) {
  const id = kind === "web" ? row.session_id : row.family_id;
  return {
    id: String(id),
    kind,
    device: sessionDeviceLabel(row.user_agent, kind),
    ipAddress: maskIp(row.ip_address),
    createdAt: row.created_at,
    lastActiveAt: row.last_seen_at || row.last_used_at || row.created_at,
    expiresAt: row.expires_at,
    current: kind === "web" && String(id) === String(currentSessionId || ""),
  };
}

export async function listEmployeeSessions(employeeId, currentSessionId) {
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

  return [
    ...web.rows.map((row) => sessionDto(row, "web", currentSessionId)),
    ...mobile.rows.map((row) => sessionDto(row, "mobile")),
  ];
}
