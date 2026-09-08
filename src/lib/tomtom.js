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
 *
 * Preserved baseline (PR #1 correction): `routeType=fastest`,
 * `computeTravelTimeFor=all` and `instructionsType=coded` were already here
 * and stay. What PR #1 adds is opt-in traffic awareness (`traffic=true`,
 * on by default), departure-time planning (`departAt`) and alternative
 * routes (`maxAlternatives`, 0-2).
 *
 * @param {[number, number]} origin      [lat, lng]
 * @param {[number, number]} destination [lat, lng]
 * @param {object} [opts]
 * @param {boolean} [opts.traffic=true]   include live traffic in travel time
 * @param {Date|string|number} [opts.departAt] departure time for traffic prediction (ISO-8601)
 * @param {number} [opts.maxAlternatives=0] 0-2 alternative routes
 */
export function buildRouteUrl(origin, destination, opts = {}) {
  const key = getServerKey();
  const params = new URLSearchParams({
    key,
    routeType: "fastest",
    computeTravelTimeFor: "all",
    instructionsType: "coded",
  });
  if (opts.traffic !== false) params.set("traffic", "true");
  if (opts.departAt != null && opts.departAt !== "") {
    const ms = new Date(opts.departAt).getTime();
    if (Number.isFinite(ms)) params.set("departAt", new Date(ms).toISOString());
  }
  const alt = Number(opts.maxAlternatives);
  if (Number.isFinite(alt) && alt > 0) params.set("maxAlternatives", String(Math.min(2, Math.floor(alt))));
  return `https://api.tomtom.com/routing/1/calculateRoute/${origin[0]},${origin[1]}:${destination[0]},${destination[1]}/json?${params.toString()}`;
}

function isValidPoint(point) {
  return Array.isArray(point)
    && point.length === 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number(point[0]) >= -90 && Number(point[0]) <= 90
    && Number(point[1]) >= -180 && Number(point[1]) <= 180;
}

function toMinutes(seconds) {
  const s = Number(seconds);
  return Number.isFinite(s) && s >= 0 ? Math.round(s / 60) : null;
}

/**
 * Parse one TomTom route object into the numeric summary the app uses.
 * `trafficDelayMin` comes from `summary.trafficDelayInSeconds`, which the
 * proxy previously dropped — it is now first-class.
 */
export function parseRouteSummary(route) {
  const summary = route?.summary || {};
  if (summary?.lengthInMeters == null || summary?.travelTimeInSeconds == null) return null;
  const delaySecs = Number(summary.trafficDelayInSeconds);
  return {
    distanceKm: Number((Number(summary.lengthInMeters) / 1000).toFixed(1)),
    durationMin: toMinutes(summary.travelTimeInSeconds),
    trafficDelayMin: Number.isFinite(delaySecs) && delaySecs >= 0 ? Math.round(delaySecs / 60) : 0,
    noTrafficMinutes: summary?.noTrafficTravelTimeInSeconds != null
      ? toMinutes(summary.noTrafficTravelTimeInSeconds)
      : null,
  };
}

/**
 * Fetch the numeric route summary used by canonical route records.
 * Returns null when routing is unavailable so callers can keep the estimate blank.
 * Now also returns `trafficDelayMin` (0 when the provider reports none).
 */
export async function fetchTomTomEstimate(origin, destination, opts = {}) {
  if (!getServerKey() || !isValidPoint(origin) || !isValidPoint(destination)) return null;
  try {
    const response = await fetch(buildRouteUrl(origin, destination, opts), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const parsed = parseRouteSummary((await response.json())?.routes?.[0]);
    if (!parsed) return null;
    return {
      ...parsed,
      confidence: "high",
      basis: "TomTom",
      source: "TomTom",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a full traffic-aware route: primary summary + geometry + guidance +
 * up to `maxAlternatives` alternative summaries. Fail-open (null) like the
 * estimate above — callers fall back to cached/snapshot/heuristic data.
 *
 * @param {[number, number]} origin      [lat, lng]
 * @param {[number, number]} destination [lat, lng]
 * @param {object} [opts]  { traffic, departAt, maxAlternatives, fetchImpl }
 */
export async function fetchTomTomRoute(origin, destination, opts = {}) {
  const { fetchImpl = fetch, ...urlOpts } = opts;
  if (!getServerKey() || !isValidPoint(origin) || !isValidPoint(destination)) return null;
  try {
    const response = await fetchImpl(buildRouteUrl(origin, destination, urlOpts), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const routes = (await response.json())?.routes || [];
    const primary = parseRouteSummary(routes[0]);
    if (!primary) return null;
    const points = routes[0]?.legs?.flatMap((leg) => leg.points || []) || [];
    const guidance = routes[0]?.guidance || {};
    return {
      ...primary,
      coordinates: points.map((p) => [p.latitude, p.longitude]),
      instructions: (guidance.instructions || []).map((inst) => ({
        message: inst.message || inst.instructionType || "Proceed along route",
        street: inst.street || inst.roadNumbers?.join(", ") || "",
        distanceMeters: inst.routeOffsetInMeters || 0,
        instructionType: inst.instructionType || "CONTINUE",
      })),
      alternatives: routes.slice(1).map(parseRouteSummary).filter(Boolean),
      confidence: "high",
      provenance: "live",
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
