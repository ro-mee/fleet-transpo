// Resolve a single decimal coordinate from an incident's stored fields.
//
// Incidents can carry their position in several shapes:
//   - decimal lat/lng columns (numeric);
//   - `location` as "lat, lng" (decimal);
//   - `location` as a Google Maps URL (?q=lat,lng);
//   - `location` as a DMS string ("14°45'06.1"N 121°03'26.3"E").
//
// This normalises all of them to a single { latitude, longitude } decimal pair
// so any UI (Google Maps "share for 911", the incident map) can use one number.

/** Parse one DMS token like "14°45'06.1\"N", "121°03'26.3\"E" or "14 45 06.1 N". */
function dmsTokenToDecimal(token) {
  const m = String(token).match(
    /([\d.]+)\s*[°º]?\s*([\d.]+)?\s*['′]?\s*([\d.]+)?\s*["″]?\s*([NSEWnsew])?/
  );
  if (!m) return null;
  const deg = Number(m[1]);
  const min = m[2] != null && m[2] !== "" ? Number(m[2]) : 0;
  const sec = m[3] != null && m[3] !== "" ? Number(m[3]) : 0;
  if (!Number.isFinite(deg)) return null;
  let value = deg + min / 60 + sec / 3600;
  const hemi = (m[4] || "").toUpperCase();
  if (hemi === "S" || hemi === "W") value = -Math.abs(value);
  return value;
}

/**
 * Parse a full DMS location string into { latitude, longitude }.
 * Handles the common inline form "14°45'06.1\"N 121°03'26.3\"E" and a
 * hemisphere separated by a space ("14°45'06.1 N 121°03'26.3 E").
 */
function parseDmsLocation(str) {
  const tokens = String(str)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Reassemble each numeric token with its (possibly separate) hemisphere so
  // dmsTokenToDecimal sees "14°45'06.1N" even when stored as "14°45'06.1 N".
  const axisTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!/[\d]/.test(t)) continue;
    let joined = t;
    if (!/[NSEWnsew]/.test(t) && i + 1 < tokens.length && /^[NSEWnsew]$/.test(tokens[i + 1])) {
      joined += tokens[i + 1];
      i++;
    }
    axisTokens.push(joined);
  }

  let latToken = null;
  let lngToken = null;
  for (const t of axisTokens) {
    if (/[NnSs]/.test(t) && latToken == null) latToken = t;
    else if (/[EeWw]/.test(t) && lngToken == null) lngToken = t;
  }
  if (latToken == null || lngToken == null) return null;
  const latitude = dmsTokenToDecimal(latToken);
  const longitude = dmsTokenToDecimal(lngToken);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

/** Parse "lat, lng" decimal text. */
function parseDecimalPair(str) {
  const m = String(str).match(
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/
  );
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/** Parse a Google Maps URL (?q=lat,lng or /@lat,lng). */
function parseMapsUrl(str) {
  const s = String(str);
  const q = s.match(/[?&]q=([-0-9.,]+)/);
  if (q) {
    const pair = parseDecimalPair(q[1]);
    if (pair) return pair;
  }
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const latitude = Number(at[1]);
    const longitude = Number(at[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
  }
  return null;
}

function valid(latitude, longitude) {
  return (
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180
  );
}

/**
 * Best-effort decimal coordinates for an incident row.
 *
 * Priority: explicit decimal lat/lng columns → "lat, lng" text → Google Maps URL
 * → DMS string. Returns `{ latitude, longitude }` (numbers) or null when no
 * coordinate can be resolved.
 */
export function resolveIncidentCoords(incident) {
  if (!incident) return null;

  const lat = Number(incident.latitude);
  const lng = Number(incident.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && valid(lat, lng)) {
    return { latitude: lat, longitude: lng };
  }

  const loc = incident.location;
  if (!loc) return null;
  const s = String(loc).trim();
  if (!s) return null;

  const fromUrl = parseMapsUrl(s);
  if (fromUrl && valid(fromUrl.latitude, fromUrl.longitude)) return fromUrl;

  const fromDecimal = parseDecimalPair(s);
  if (fromDecimal && valid(fromDecimal.latitude, fromDecimal.longitude)) return fromDecimal;

  const fromDms = parseDmsLocation(s);
  if (fromDms && valid(fromDms.latitude, fromDms.longitude)) return fromDms;

  return null;
}
