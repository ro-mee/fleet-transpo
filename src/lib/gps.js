// GPS values are written by Expo Location. `speed` is meters per second;
// expose an explicit conversion at the API/UI boundary instead of guessing in
// individual consumers.
export const GPS_FRESH_MS = 90_000;
export const GPS_DELAYED_MS = 300_000;

export function isValidCoordinate(latitude, longitude) {
  if (latitude == null || longitude == null || String(latitude).trim() === "" || String(longitude).trim() === "") return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function speedKmhFromMps(speed) {
  if (speed == null || String(speed).trim() === "") return null;
  const value = Number(speed);
  return Number.isFinite(value) ? Number((value * 3.6).toFixed(1)) : null;
}

export function getGpsHealth(recordedAt, now = Date.now()) {
  const timestamp = recordedAt ? new Date(recordedAt).getTime() : NaN;
  if (!Number.isFinite(timestamp)) {
    return { key: "no-signal", label: "No signal", ageMs: null };
  }

  const ageMs = Math.max(0, Number(now) - timestamp);
  if (ageMs <= GPS_FRESH_MS) {
    return { key: "fresh", label: "Fresh", ageMs };
  }
  if (ageMs <= GPS_DELAYED_MS) {
    return { key: "delayed", label: "Delayed", ageMs };
  }
  return { key: "stale", label: "Offline", ageMs };
}

export function formatGpsAge(recordedAt, now = Date.now()) {
  const { ageMs } = getGpsHealth(recordedAt, now);
  if (ageMs == null) return "No signal";

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
