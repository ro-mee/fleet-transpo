// Current-weather adapter (Open-Meteo) for the GPS ingest response.
//
// Feeds the mobile map screen's compact ambient weather chip. Keyed to the
// coordinates of the fix the driver is already posting — no new location
// source, no API key shipped anywhere (Open-Meteo's current-weather endpoint
// is free and keyless), and nothing durable: weather is display-only context,
// never stored.
//
// Every failure path is fail-open to null. A weather hiccup must never fail
// the GPS write it decorates (same guarantee as evaluatePingMonitor), and
// because the mobile poster waits on this response every ~30 s, the provider
// call is capped at ~2 s rather than the 8 s a richer surface could afford.

// WMO weather interpretation codes (WW) → short human label. Only the codes
// Open-Meteo documents for `weather_code`; anything else falls back to null
// (unknown → no chip, never an invented label).
const WMO_LABELS = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  56: "Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Light Showers",
  81: "Showers",
  82: "Violent Showers",
  85: "Snow Showers",
  86: "Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm + Hail",
  99: "Thunderstorm + Hail",
};

const FETCH_TIMEOUT_MS = 2000;
// Weather changes slowly while GPS pings arrive every ~30 s, so the provider
// must never see a per-ping call. Best-effort cache per server instance, keyed
// by a coarse ~0.1° grid cell (approximate spacing — longitude distance varies
// with latitude, so no exact-km claim). Same stance as the geofence target
// cache: durable state stays in Postgres, and weather is explicitly not
// durable state.
const CELL_DEGREES = 0.1;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map(); // "lat,lng" → { expiresAt, weather }

import { getPlaceName } from "./geo/reverse-geocode";

/**
 * Parse an Open-Meteo current-weather response into the chip's payload.
 * Pure: no fetch, no cache — the vitest suite exercises this directly.
 * @returns {{temperatureC: number, code: number, label: string}|null}
 */
export function parseCurrentWeather(payload) {
  const current = payload?.current;
  if (!current) return null;
  const temperatureC = Number(current.temperature_2m);
  const code = Number(current.weather_code);
  if (!Number.isFinite(temperatureC) || !Number.isFinite(code)) return null;
  const label = WMO_LABELS[code];
  if (!label) return null; // unknown code → silence, never an invented label
  return { temperatureC, code, label };
}

function cellKey(latitude, longitude) {
  const lat = Math.round(Number(latitude) / CELL_DEGREES) * CELL_DEGREES;
  const lng = Math.round(Number(longitude) / CELL_DEGREES) * CELL_DEGREES;
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/**
 * Current weather at a coordinate, or null. Cached per coarse grid cell for
 * 10 minutes; the provider call is capped at ~2 s and every failure (network,
 * timeout, malformed payload, unknown weather code) resolves to null.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 */
export async function getCurrentWeather(latitude, longitude, opts = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = cellKey(lat, lng);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.weather;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let weather = null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response?.ok) weather = parseCurrentWeather(await response.json());
  } catch {
    weather = null; // timeout / network / parse — fail open
  }

  // Cache the null too: a provider outage shouldn't hammer it once per ping
  // for the same cell. Shorter TTL so recovery is quick.
  cache.set(key, { expiresAt: now + (weather ? CACHE_TTL_MS : 60 * 1000), weather });
  return weather;
}

/**
 * Weather + place label for the chip: the mobile pill shows WHERE the driver
 * is ("Quezon City"), with the icon carrying the condition — so the payload
 * combines the current weather with a reverse-geocoded place name. Place is
 * fail-open like weather: absent key/timeout/parse → placeName null (the chip
 * then shows icon + temperature only, never an invented place).
 *
 * @returns {Promise<{temperatureC: number, code: number, label: string, placeName: string|null}|null>}
 */
export async function getCurrentConditions(latitude, longitude, opts = {}) {
  const weather = await getCurrentWeather(latitude, longitude, opts);
  if (!weather) return null;
  let placeName = null;
  try {
    placeName = await getPlaceName(latitude, longitude, opts);
  } catch {
    placeName = null;
  }
  return { ...weather, placeName };
}
