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

// WMO weather interpretation codes → Ionicons glyph (filled family for the
// richer read; the WeatherIcon wrapper adds the dual-tone treatment). Kept in
// sync with the server's WMO_LABELS in src/lib/weather.js (same code space,
// different output: an icon here, a human label there).
const WMO_ICONS = {
  0: "sunny",
  1: "sunny",
  2: "partly-sunny",
  3: "cloudy",
  45: "cloudy",
  48: "cloudy",
  51: "rainy",
  53: "rainy",
  55: "rainy",
  56: "rainy",
  57: "rainy",
  61: "rainy",
  63: "rainy-outline",
  65: "rainy",
  66: "rainy",
  67: "rainy",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "rainy",
  81: "rainy-outline",
  82: "rainy",
  85: "snow",
  86: "snow",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
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
 *   or /api/mobile/driver/weather — { temperatureC, code, label, placeName? }
 * @returns {{icon: string, temperature: string, label: string}|null}
 */
export function weatherChipFor(weather) {
  if (!weather) return null;
  const icon = WMO_ICONS[Number(weather.code)];
  const temperature = formatTemperature(weather.temperatureC);
  if (!icon || !temperature) return null;
  // Label precedence: placeName (server-reverse-geocoded, e.g. "Quezon City")
  // → the condition string from the server's WMO table. Both come from the
  // server — never invented here. Neither → no chip.
  const place = typeof weather.placeName === "string" ? weather.placeName.trim() : "";
  const condition = typeof weather.label === "string" ? weather.label.trim() : "";
  const label = place || condition;
  if (!label) return null;
  return { icon, temperature, label };
}
