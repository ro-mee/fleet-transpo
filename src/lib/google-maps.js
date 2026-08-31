const GOOGLE_MAP_HOSTS = new Set([
  "google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

const NUMBER = "(-?\\d{1,3}(?:\\.\\d+)?)";

function pair(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

export function isGoogleMapsUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return ["https:", "http:"].includes(url.protocol) && GOOGLE_MAP_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function parseGoogleMapsCoordinates(value) {
  if (!isGoogleMapsUrl(value)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(String(value).trim());
  } catch {
    decoded = String(value).trim();
  }

  const patterns = [
    new RegExp(`@${NUMBER},${NUMBER}`),
    new RegExp(`!3d${NUMBER}.*?!4d${NUMBER}`),
    new RegExp(`(?:[?&](?:q|query|destination|origin|ll|center)=)${NUMBER}[,%+ ]+${NUMBER}`, "i"),
    new RegExp(`/(?:place|search)/${NUMBER},${NUMBER}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const numbers = match.slice(1).map(Number);
    const result = pair(numbers[0], numbers[1]);
    if (result) return result;
  }
  return null;
}

export async function resolveGoogleMapsCoordinates(value) {
  const direct = parseGoogleMapsCoordinates(value);
  if (direct || !isGoogleMapsUrl(value)) return direct;

  try {
    let current = new URL(value.trim());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) return null;
      const next = new URL(location, current);
      if (!isGoogleMapsUrl(next.toString())) return null;
      const coordinates = parseGoogleMapsCoordinates(next.toString());
      if (coordinates) return coordinates;
      current = next;
    }
  } catch {
    return null;
  }
  return null;
}
