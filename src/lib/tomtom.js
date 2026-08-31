// TomTom Maps URL builders.
//
// Two keys exist: a PUBLIC key used in URLs the browser/mobile loads directly
// (raster tiles, traffic tiles, static images) and a SERVER key used only by
// the routing proxy (src/app/api/tomtom/route/route.js) so the routing key is
// never shipped to the client. Create the public key domain-restricted in the
// TomTom dashboard.

export function getPublicKey() {
  return process.env.NEXT_PUBLIC_TOMTOM_API_KEY || "";
}

export function getServerKey() {
  return process.env.TOMTOM_API_KEY || "";
}

/**
 * TomTom raster tile URL for react-leaflet's TileLayer.
 * See https://developer.tomtom.com/maps-sdk-web/map/documentation
 * @param {number} [tileSize=256]
 */
export function rasterTileUrl(tileSize = 256) {
  const key = getPublicKey();
  const query = key ? `key=${encodeURIComponent(key)}&` : "";
  return `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?${query}tileSize=${tileSize}`;
}

/**
 * TomTom live traffic-flow tile URL (an overlay layer).
 * @param {number} [tileSize=256]
 */
export function trafficTileUrl(tileSize = 256) {
  const key = getPublicKey();
  const query = key ? `key=${encodeURIComponent(key)}&` : "";
  return `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?${query}tileSize=${tileSize}`;
}

/**
 * Build a static image URL for the mobile app (Expo Go safe — a plain <Image>,
 * no native map module).
 *
 * @param {object} opts
 * @param {[number, number]} opts.center   [lat, lng]
 * @param {number} [opts.zoom]
 * @param {number} [opts.width=400]
 * @param {number} [opts.height=300]
 * @param {Array<{ lat: number, lng: number, color?: string, label?: string }>} [opts.markers]
 */
export function staticImageUrl({
  center,
  zoom = 13,
  width = 400,
  height = 300,
  markers = [],
}) {
  const key = getPublicKey();
  const params = new URLSearchParams({
    key,
    format: "png",
    zoom: String(zoom),
    width: String(width),
    height: String(height),
  });
  if (center) params.set("center", `${center[1]},${center[0]}`);
  for (const m of markers) {
    const color = m.color || "D50000";
    // Two markers: a "from" pin (D50000, red) and a "to" pin (00AA00, green).
    const src = color === "green" ? "to" : "from";
    let spec = `color:0x${color}|label:${src}|${m.lat},${m.lng}`;
    if (m.label) spec = `color:0x${color}|label:${encodeURIComponent(m.label)}|${m.lat},${m.lng}`;
    params.append("markers", spec);
  }
  return `https://api.tomtom.com/map/1/staticimage?${params.toString()}`;
}

/**
 * Build the TomTom Routing API computeRoute URL (server-side only).
 * The path coordinates are `lat,lon` (TomTom's documented format).
 * @param {[number, number]} origin      [lat, lng]
 * @param {[number, number]} destination [lat, lng]
 */
export function buildRouteUrl(origin, destination) {
  const key = getServerKey();
  return `https://api.tomtom.com/routing/1/calculateRoute/${origin[0]},${origin[1]}:${destination[0]},${destination[1]}/json?key=${key}&routeType=fastest&computeTravelTimeFor=all&instructionsType=coded`;
}

/**
 * Fetch the numeric route summary used by canonical route records.
 * Returns null when routing is unavailable so callers can keep the estimate blank.
 */
export async function fetchTomTomEstimate(origin, destination) {
  const validPoint = (point) => Array.isArray(point)
    && point.length === 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number(point[0]) >= -90 && Number(point[0]) <= 90
    && Number(point[1]) >= -180 && Number(point[1]) <= 180;
  if (!getServerKey() || !validPoint(origin) || !validPoint(destination)) return null;
  try {
    const response = await fetch(buildRouteUrl(origin, destination), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const summary = (await response.json())?.routes?.[0]?.summary;
    if (summary?.lengthInMeters == null || summary?.travelTimeInSeconds == null) return null;
    return {
      distanceKm: Number((Number(summary.lengthInMeters) / 1000).toFixed(1)),
      durationMin: Math.round(Number(summary.travelTimeInSeconds) / 60),
      confidence: "high",
      basis: "TomTom",
      source: "TomTom",
    };
  } catch {
    return null;
  }
}

/**
 * Decode a Google-encoded polyline string into [[lat, lng], ...].
 * @param {string} encoded
 */
export function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
