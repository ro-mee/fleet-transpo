import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { api } from "./api";
import { useSettings } from "./settings-context";
import { getActiveStatuses } from "./tripRef";

const POST_INTERVAL_MS = 30 * 1000;
// How often the poster re-checks which trip is active, so a trip accepted or
// completed on another screen is picked up without any screen coordination.
const TRIP_REFRESH_MS = 60 * 1000;

// ── Poster status pub/sub ──────────────────────────────────────────────────
// The poster is mounted once at the (app) layout level; screens subscribe to
// this to render their tracking chip without each owning a poster.
let posterStatus = { lastSentAt: null, error: null };
const statusListeners = new Set();

function publishStatus(patch) {
  posterStatus = { ...posterStatus, ...patch };
  statusListeners.forEach((l) => l(posterStatus));
}

export function usePosterStatus() {
  const [status, setStatus] = useState(posterStatus);
  useEffect(() => {
    statusListeners.add(setStatus);
    return () => statusListeners.delete(setStatus);
  }, []);
  return status;
}

// ── The single GPS poster ──────────────────────────────────────────────────
/**
 * Posts the driver's location every 30 seconds while the app is foregrounded:
 * to the active trip when there is one, otherwise to any incident this driver
 * is the assigned fleet responder on (the rescue that tracks itself).
 *
 * Mounted ONCE, in the (app) layout — screens never post. Previously each
 * screen had its own poster: the tab screens stay mounted after being visited,
 * so three visited tabs meant up to 3 duplicate GPS rows per 30 seconds, and
 * any screen pushed on top of the tabs meant zero posts. One owner fixes both.
 *
 * The background task (lib/background-tracking.js) covers the app being
 * backgrounded; this hook skips its tick while the app is not active.
 *
 * @param {boolean} enabled  false until the driver is signed in and consented
 */
export function useActiveTripGpsPoster(enabled) {
  const { settings } = useSettings();

  useEffect(() => {
    if (!enabled || !settings.locationTracking) return;

    let cancelled = false;
    let interval = null;
    let tripId = null;
    let responderIncidentId = null;
    let lastTripFetch = 0;

    publishStatus({ error: null });

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        publishStatus({
          error: "Location is off. Turn it on in Settings so dispatch can see your trip.",
        });
        return;
      }

      const findActiveTrip = async () => {
        try {
          const [trips, activeStatuses] = await Promise.all([
            api.get("/api/mobile/driver/trips"),
            getActiveStatuses(),
          ]);
          if (cancelled) return;
          const active = (Array.isArray(trips) ? trips : []).find((t) =>
            activeStatuses.includes(t.trip_status)
          );
          // A completed/cancelled trip is left in place: the server drops
          // posts to non-live trips, and the next refresh replaces it.
          tripId = active?.trip_id ?? null;
        } catch {
          // Keep the previous tripId; the next tick retries.
        }
      };

      // A responder mission is checked on the same 60s cadence: if this driver
      // was assigned to help a stranded driver and is not on a trip, their
      // position feeds the incident's rescue ladder (En Route / Arrived / ETA).
      const findResponderMission = async () => {
        try {
          const missions = await api.get("/api/driver/incidents?role=responder");
          if (cancelled) return;
          responderIncidentId =
            Array.isArray(missions) && missions.length ? missions[0].incident_id : null;
        } catch {
          // Keep the previous assignment; the next refresh retries.
        }
      };

      const tick = async () => {
        if (cancelled || AppState.currentState.match(/background|inactive/)) return;
        const now = Date.now();
        if (now - lastTripFetch >= TRIP_REFRESH_MS) {
          lastTripFetch = now;
          await findActiveTrip();
          await findResponderMission();
        }
        if (!tripId && !responderIncidentId) return;
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          if (tripId) {
            // Trip GPS wins when both exist: it updates the same
            // drivers.current_* columns the responder evaluation reads, so
            // posting twice would only be a duplicate.
            await api.post(`/api/mobile/driver/trips/${tripId}/gps`, {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              speed: loc.coords.speed ?? null,
              heading: loc.coords.heading ?? null,
              altitude: loc.coords.altitude ?? null,
              accuracy: loc.coords.accuracy ?? null,
              recorded_at: new Date(loc.timestamp).toISOString(),
            });
          } else {
            // Never queued offline — a stale replayed fix must not overwrite
            // the live position driving the rescue status.
            await api.post(
              "/api/driver/responder/location",
              {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              },
              { queueOnFailure: false }
            );
          }
          if (!cancelled) publishStatus({ lastSentAt: new Date().toISOString(), error: null });
        } catch {
          // A dropped post is not worth interrupting the driver over; the next
          // tick retries. Only surface it so the chip can show it is stale.
          if (!cancelled) publishStatus({ error: "Location not sent. Retrying." });
        }
      };

      await tick();
      if (cancelled) return;
      interval = setInterval(tick, POST_INTERVAL_MS);
    })().catch(() => {
      if (!cancelled) {
        publishStatus({ error: "Current location is unavailable. Turn on Location services to resume tracking." });
      }
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [enabled, settings.locationTracking]);
}

// ── Screen-side display hook ───────────────────────────────────────────────
/**
 * Watch-only companion for screens: streams the driver's position for local
 * UI (Vehicle's live marker, Home's tracking chip) and mirrors the global
 * poster's last-sent/error status. Never posts — the poster owns that.
 *
 * Focus-gated: the tab screens stay mounted after being visited, so an
 * unfocused tab doesn't keep a second position watcher running for UI nobody
 * is looking at.
 *
 * @param {number | null} tripId  active trip, or null to stop watching
 */
export function useTripTracking(tripId) {
  const { settings } = useSettings();
  const focused = useIsFocused();
  const poster = usePosterStatus();
  const [watching, setWatching] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [latestFix, setLatestFix] = useState(null);

  const configError = !settings.locationTracking && tripId ? "Location tracking disabled in Settings." : null;

  useEffect(() => {
    let subscription = null;
    let cancelled = false;

    if (!tripId || !settings.locationTracking || !focused) {
      return;
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setWatching(false);
        return;
      }

      setLocalError(null);
      setWatching(true);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => {
          if (cancelled) return;
          setLatestFix({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      );
      if (cancelled) subscription.remove();
    })().catch(() => {
      if (!cancelled) setWatching(false);
    });

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
      setWatching(false);
      setLatestFix(null);
    };
  }, [tripId, settings.locationTracking, focused]);

  return {
    posting: watching && !configError,
    lastSentAt: poster.lastSentAt,
    error: configError || (tripId ? localError : null) || poster.error,
    latestFix,
  };
}
