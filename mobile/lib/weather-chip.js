// Weather chip derivation — PURE, no React Native imports, so the repo-root
// vitest suite can exercise it directly (tracking.js pulls in expo-location
// and cannot run under node).
//
// The GPS POST the poster fires returns the ingest-side weather payload
// (getCurrentConditions). This module turns that into the compact ambient chip
// the driver sees on the Home header — informational context only. Weather is
// NEVER a banner, toast, or notification: actionable driving issues (off-route
// / traffic / GPS) already own the one calm banner surface (monitor-banner.js),
// and the weather chip must not compete with it.
//
// Label precedence: the reverse-geocoded placeName ("Quezon City") — WHERE the
// driver is — because the icon already carries the condition. The condition
// string is the fallback when no truthful place is available, never invented.

// WMO weather interpretation codes → Meteocons semantic key (Fill static
// art in mobile/assets/images/weather/, MIT © Bas Milius — see ATTRIBUTION.md
// there). Kept in sync with the server's WMO_LABELS in src/lib/weather.js
// (same code space, different output: an icon here, a human label there).
//
// Single coherent family: every rain code shares one key, every drizzle code
// shares one key — intensity lives in the temperature/place label, not in
// subtleties the driver cannot decode at a glance. No showers/sleet keys
// exist upstream, so showers read as rain and snow showers as snow.
export const WEATHER_ICON_KEYS = [
  "clear-day",
  "clear-night",
  "mostly-clear-day",
  "mostly-clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "thunderstorms",
];

const WMO_ICONS = {
  0: "clear-day",
  1: "mostly-clear-day",
  2: "partly-cloudy-day",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "rain",
  81: "rain",
  82: "rain",
  85: "snow",
  86: "snow",
  95: "thunderstorms",
  96: "thunderstorms",
  99: "thunderstorms",
};

// Night overrides, applied when the server reports is_day = 0 (Open-Meteo's
// day/night flag, passed through getCurrentConditions). Clear skies get true
// night art; everything else keeps its day key (clouds, rain, and storms look
// the same after dark at chip size).
// A missing flag (isDay null) falls back to the day variant — never silence.
const NIGHT_ICONS = {
  0: "clear-night",
  1: "mostly-clear-night",
  2: "partly-cloudy-night",
};

/**
 * Format a Celsius temperature as the chip's primary value: whole degrees,
 * degree sign. An absent/invalid temperature is silence, never "0°" or "NaN°"
 * (Number(null) is 0, so null must be checked before coercion).
 */
export function formatTemperature(celsius) {
  if (celsius == null) return null;
  const n = Number(celsius);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)}°`;
}

/**
 * @param {object|null} weather  payload from /api/mobile/driver/trips/:id/gps
 *   or /api/mobile/driver/weather —
 *   { temperatureC, code, label, isDay?, placeName? }
 * @returns {{icon: string (Meteocons key, see WEATHER_ICON_KEYS), temperature: string, label: string, isNight: boolean}|null}
 */
export function weatherChipFor(weather) {
  if (!weather) return null;
  const code = Number(weather.code);
  const dayIcon = WMO_ICONS[code];
  const temperature = formatTemperature(weather.temperatureC);
  if (!dayIcon || !temperature) return null;
  // Label precedence: placeName (server-reverse-geocoded, e.g. "Quezon City")
  // → the condition string from the server's WMO table. Both come from the
  // server — never invented here. Neither → no chip.
  const place = typeof weather.placeName === "string" ? weather.placeName.trim() : "";
  const condition = typeof weather.label === "string" ? weather.label.trim() : "";
  const label = place || condition;
  if (!label) return null;
  const isNight = weather.isDay === false || weather.isDay === 0;
  const icon = isNight && NIGHT_ICONS[code] ? NIGHT_ICONS[code] : dayIcon;
  return { icon, temperature, label, isNight };
}
