import { finiteNumberInRange } from "./map-webview-data";

// Throttle + payload helpers for the React Native → WebView fleet bridge
// (TomTomMap.js). The bridge carries high-frequency GPS ticks; the backend
// telemetry path (lib/tracking.js poster, 30 s cadence) is intentionally
// separate so network I/O can never block UI map updates.

// Local WebView bridge: at most one inject per interval while moving.
export const FLEET_BRIDGE_PUSH_MS = 1500;
// WebView-side driver-point interpolation window (lerp, ~1.2 s).
export const FLEET_ANIMATION_MS = 1200;
// Camera glide re-fires only after this much combined lat/lng movement
// (~16 m), so heading-only ticks never restart the easeTo animation.
export const FLEET_CAMERA_STEP_DEG = 0.00015;

// Backend API sync cadence lives in lib/tracking.js (POST_INTERVAL_MS,
// 30 s — slower than the bridge on purpose). Recorded here so the two
// throttles stay visibly decoupled.
export const BACKEND_TELEMETRY_MS = 30 * 1000;

function safeResponderId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.slice(0, 120);
  return null;
}

// Only the fields the WebView layers consume ever cross the bridge —
// never raw trip objects (same posture as normalizeRadarMarkers).
export function normalizeFleetResponders(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const lat = finiteNumberInRange(entry.lat, -90, 90);
    const lng = finiteNumberInRange(entry.lng, -180, 180);
    if (lat == null || lng == null) return [];
    return [{ id: safeResponderId(entry.id), lat, lng }];
  });
}

// Stable string identity for a responder list: per-fix array identities
// must not re-fire bridge pushes or document rebuilds on their own.
export function fleetRespondersSignature(list) {
  try {
    return JSON.stringify(normalizeFleetResponders(list));
  } catch {
    return "[]";
  }
}

// Timestamp guard for injectJavaScript: first push always allowed, then at
// most once per interval.
export function shouldPushFleetBridge(nowMs, lastPushMs, intervalMs = FLEET_BRIDGE_PUSH_MS) {
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(lastPushMs) || lastPushMs <= 0) return true;
  return nowMs - lastPushMs >= intervalMs;
}

// Direct global-function invocation (no postMessage round-trip) carrying one
// GPS tick. Returns null when the fix is unusable so the caller skips the
// inject entirely.
export function buildFleetPositionJs(lat, lng, heading, respondersJson) {
  const safeLat = finiteNumberInRange(lat, -90, 90);
  const safeLng = finiteNumberInRange(lng, -180, 180);
  if (safeLat == null || safeLng == null) return null;
  // Null lets the document keep its last valid heading; zero means north.
  const safeHeading = finiteNumberInRange(heading, 0, 360);
  let payload = "[]";
  if (typeof respondersJson === "string" && respondersJson) {
    try {
      payload = JSON.stringify(normalizeFleetResponders(JSON.parse(respondersJson)));
    } catch {
      payload = "[]";
    }
  } else if (Array.isArray(respondersJson)) {
    payload = JSON.stringify(normalizeFleetResponders(respondersJson));
  }
  return (
    `window.__updateFleetPositions && window.__updateFleetPositions(` +
    `${safeLat}, ${safeLng}, ${safeHeading}, ${payload}); true;`
  );
}

export function buildMapActiveJs(active) {
  return `window.__setMapActive && window.__setMapActive(${active === true}); true;`;
}
