const MARKER_TYPES = new Set(["assignment", "gas_station", "driver", "vehicle", "alert"]);
const MARKER_PRIORITIES = new Set(["normal", "priority", "emergency", "station", "vehicle"]);

export function serializeInlineScriptValue(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "null";
  }

  if (serialized === undefined) return "null";
  return serialized.replace(/[<\u2028\u2029]/g, (character) => {
    if (character === "<") return "\\u003c";
    if (character === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

export function finiteNumberInRange(value, min, max) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function serializeCssString(value) {
  const escaped = String(value ?? "").replace(/[\u0000-\u001f\u007f\\"<>]/g, (character) => {
    return `\\${character.codePointAt(0).toString(16)} `;
  });
  return `"${escaped}"`;
}

function safeText(value, fallback = "", maxLength = 240) {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function safeId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "string" ? value.slice(0, 120) : null;
}

export function normalizeRadarMarkers(markers) {
  if (!Array.isArray(markers)) return [];

  return markers.flatMap((marker) => {
    if (!marker || typeof marker !== "object") return [];
    const lat = finiteNumberInRange(marker.lat, -90, 90);
    const lng = finiteNumberInRange(marker.lng, -180, 180);
    if (lat == null || lng == null) return [];

    const normalized = {
      id: safeId(marker.id),
      type: MARKER_TYPES.has(marker.type) ? marker.type : "assignment",
      title: safeText(marker.title, "Assignment"),
      subtitle: safeText(marker.subtitle),
      priority: MARKER_PRIORITIES.has(marker.priority) ? marker.priority : "normal",
      lat,
      lng,
      distanceKm: finiteNumberInRange(marker.distanceKm, 0, 100000),
      etaMinutes: finiteNumberInRange(marker.etaMinutes, 0, 100000),
      etaSource: safeText(marker.etaSource, "", 40),
      status: safeText(marker.status, "", 80),
      tripId: safeId(marker.tripId),
    };
    return [normalized];
  });
}
