// PR #4 driver banner derivation — PURE, no React Native imports, so the
// repo-root vitest suite can exercise it directly (tracking.js pulls in
// expo-location and cannot run under node).
//
// The GPS POST the poster fires returns the ingest-side monitor verdict
// (evaluatePingMonitor). This module turns that payload into the ONE minimal
// banner the driver sees on the map screen — calm, driving-appropriate copy,
// no risk-level jargon, no dispatcher-style next-trip panic. Those heavier
// surfaces live on the operations side.

/**
 * @param {object|null} monitor  payload from /api/mobile/driver/trips/:id/gps
 * @returns {{key: "off_route"|"traffic"|"gps", title: string, subtitle: string}|null}
 */
export function monitorBannerFor(monitor) {
  if (!monitor || monitor.live === false) return null;
  if (monitor.offRoute?.state === "off_route") {
    return {
      key: "off_route",
      title: "Route deviation detected",
      subtitle: "Check your navigation when safe.",
    };
  }
  const traffic = Number(monitor.trafficDelayMin);
  if (Number.isFinite(traffic) && traffic >= 5) {
    return {
      key: "traffic",
      title: "Heavy traffic ahead",
      subtitle: `Arrival may be delayed by about ${Math.round(traffic)} min.`,
    };
  }
  if (monitor.gpsHealth === "delayed") {
    return {
      key: "gps",
      title: "GPS updates delayed",
      subtitle: "Keep location access enabled.",
    };
  }
  return null;
}
