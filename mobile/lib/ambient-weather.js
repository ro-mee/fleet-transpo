import { useCallback, useEffect, useRef, useState } from "react";
import { InteractionManager, Platform } from "react-native";
import * as Location from "expo-location";
import { api } from "./api";
import { CACHE_KEYS, getCached, setCached } from "./offline-cache";
import { weatherChipFor } from "./weather-chip";

// ── Ambient weather fetch (no-trip state) ───────────────────────────────────
//
// While a trip is live, the GPS POST response already carries the weather
// payload (published trip-id-tagged by usePosterStatus). This hook covers the
// REST of the time — idle, between trips, pre-assignment — so the Home header
// chip is visible whenever there is a truthful payload, not only en route.
//
// Instant-paint contract:
// - the last-good payload is read from AsyncStorage on mount and paints
//   immediately (cold open shows weather, not a blank slot);
// - the network revalidates AFTER first paint, off the critical path
//   (InteractionManager.runAfterInteractions) — never gated on a GPS fix;
// - GPS is a refinement, not a gate: an immediate coord-less fetch goes out
//   first (the server falls back to the driver's last-known position) and a
//   one-shot fix triggers a second fetch only when the driver moved cells.
// Location permission is only READ here — if it is already granted we attach
// a one-shot fix; if not, the server fallback stands and we never trigger a
// prompt. One-shot reads, never a watcher: a position watch would run
// continuously for a decorative chip.
//
// Weather from a live trip still wins while a trip is live: the poster's
// payload (trip-id-guarded, freshest, same rail as geofence/monitor) is
// preferred over this refetch.

const FETCH_INTERVAL_MS = 10 * 60 * 1000; // server cache TTL — aligned cadence
// Mirrors the server's coarse grid (src/lib/weather.js CELL_DEGREES): a
// refinement fetch is only worth the round trip when the fix left the cell.
const CELL_DEGREES = 0.1;

function cellKey(latitude, longitude) {
  const lat = Math.round(Number(latitude) / CELL_DEGREES) * CELL_DEGREES;
  const lng = Math.round(Number(longitude) / CELL_DEGREES) * CELL_DEGREES;
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/**
 * @param {object|null} tripWeather  the poster's trip-id-guarded weather
 *   payload (null when no live trip / GPS post failed) — takes precedence.
 * @param {string|null} driverId  per-driver cache namespace (resolveDriverId);
 *   null skips the cache read/write but the live fetch still runs.
 * @returns {{chip: {icon, temperature, label, isNight}|null, chipSource: "trip"|"local"|null}}
 */
export function useAmbientWeather(tripWeather, driverId = null) {
  const [localWeather, setLocalWeather] = useState(null);
  const inFlight = useRef(false);
  const refinedCell = useRef(null);
  const driverIdRef = useRef(driverId);
  useEffect(() => {
    driverIdRef.current = driverId;
  }, [driverId]);

  // Cache-first paint: last-good payload shows instantly, before any network.
  useEffect(() => {
    if (Platform.OS === "web" || driverId == null) return undefined;
    let cancelled = false;
    getCached(driverId, CACHE_KEYS.AMBIENT_WEATHER)
      .then((entry) => {
        if (!cancelled && entry?.data) setLocalWeather(entry.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  const applyPayload = useCallback((payload) => {
    // A null payload (no position anywhere) must never wipe last-good: keep
    // the cached chip and stay silent. No setState on null either — the
    // state is already the best we have, so skip the re-render entirely.
    if (!payload) return;
    setLocalWeather(payload);
    const id = driverIdRef.current;
    if (id != null) {
      // Fire-and-forget: cache must never break or delay the chip.
      setCached(id, CACHE_KEYS.AMBIENT_WEATHER, payload).catch(() => {});
    }
  }, []);

  const fetchWeather = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // 1. Immediate coord-less fetch — the server resolves the driver's
      // last-known position. This is the first-paint network path and it
      // never waits on GPS hardware.
      try {
        const res = await api.get("/api/mobile/driver/weather");
        applyPayload(res?.weather ?? null);
      } catch {
        // Offline/failed → keep the cached payload; the next interval
        // retries. Never an error surface for a decorative chip.
      }
      // 2. One-shot refinement — only used when permission is ALREADY
      // granted (this endpoint must never be the reason a location prompt
      // appears), and only fetched when the fix left the last-refined cell.
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const lat = loc.coords?.latitude;
          const lng = loc.coords?.longitude;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const cell = cellKey(lat, lng);
            if (cell !== refinedCell.current) {
              refinedCell.current = cell;
              try {
                const res = await api.get(
                  `/api/mobile/driver/weather?latitude=${lat}&longitude=${lng}`
                );
                applyPayload(res?.weather ?? null);
              } catch {
                // Refinement failed — the coord-less payload above stands.
              }
            }
          }
        }
      } catch {
        // No usable fix → the server fallback stands.
      }
    } finally {
      inFlight.current = false;
    }
  }, [applyPayload]);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    // Off the critical path: hero + trips paint first, weather revalidates
    // once interactions settle. The cached payload already painted above.
    const task = InteractionManager.runAfterInteractions(() => {
      fetchWeather();
    });
    const interval = setInterval(fetchWeather, FETCH_INTERVAL_MS);
    return () => {
      task?.cancel?.();
      clearInterval(interval);
    };
  }, [fetchWeather]);

  // Trip payload (guarded by the caller) wins while present; otherwise the
  // local no-trip fetch feeds the chip; no truthful payload → no chip.
  if (tripWeather) {
    return { chip: weatherChipFor(tripWeather), chipSource: "trip", weather: tripWeather };
  }
  return { chip: weatherChipFor(localWeather), chipSource: localWeather ? "local" : null, weather: localWeather };
}
