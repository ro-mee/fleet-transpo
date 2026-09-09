import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { api } from "./api";
import { weatherChipFor } from "./weather-chip";

// ── Ambient weather fetch (no-trip state) ───────────────────────────────────
//
// While a trip is live, the GPS POST response already carries the weather
// payload (published trip-id-tagged by usePosterStatus). This hook covers the
// REST of the time — idle, between trips, pre-assignment — so the Home header
// chip is visible whenever there is a truthful payload, not only en route.
//
// One-shot fetch, never a watcher: a position watch would run continuously
// for a decorative chip. Location permission is only READ here — if it is
// already granted we attach a one-shot fix; if not, the server falls back to
// the driver's last-known position and we never trigger a prompt.
//
// Weather from a live trip still wins while a trip is live: the poster's
// payload (trip-id-guarded, freshest, same rail as geofence/monitor) is
// preferred over this refetch.

const FETCH_INTERVAL_MS = 10 * 60 * 1000; // server cache TTL — aligned cadence

/**
 * @param {object|null} tripWeather  the poster's trip-id-guarded weather
 *   payload (null when no live trip / GPS post failed) — takes precedence.
 * @returns {{chip: {icon, temperature, label}|null, chipSource: "trip"|"local"|null}}
 */
export function useAmbientWeather(tripWeather) {
  const [localWeather, setLocalWeather] = useState(null);
  const inFlight = useRef(false);

  const fetchWeather = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      let params = "";
      try {
        // Only used when permission is ALREADY granted — this endpoint must
        // never be the reason a location prompt appears.
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const lat = loc.coords?.latitude;
          const lng = loc.coords?.longitude;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            params = `?latitude=${lat}&longitude=${lng}`;
          }
        }
      } catch {
        // No usable fix → let the server fall back to last-known position.
      }
      try {
        const res = await api.get(`/api/mobile/driver/weather${params}`);
        setLocalWeather(res?.weather ?? null);
      } catch {
        // Offline/failed → keep the last successful local payload; the next
        // interval retries. Never an error surface for a decorative chip.
        setLocalWeather((w) => w);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    fetchWeather();
    const interval = setInterval(fetchWeather, FETCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  // Trip payload (guarded by the caller) wins while present; otherwise the
  // local no-trip fetch feeds the chip; no truthful payload → no chip.
  if (tripWeather) {
    return { chip: weatherChipFor(tripWeather), chipSource: "trip" };
  }
  return { chip: weatherChipFor(localWeather), chipSource: localWeather ? "local" : null };
}
