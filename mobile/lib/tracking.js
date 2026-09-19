import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { api } from "./api";
import { useSettings } from "./settings-context";
import { getActiveStatuses } from "./tripRef";
import { monitorBannerFor } from "./monitor-banner";
import { weatherChipFor } from "./weather-chip";
import { createMotionState, recordFix, isDrivingAt } from "./motion-state";

// Re-exported for screens: the pure PR #4 banner derivation (implemented in
// its own RN-import-free module so the vitest suite can exercise it).
export { monitorBannerFor };
// Same for the weather chip derivation (2026-09-09).
export { weatherChipFor };

const POST_INTERVAL_MS = 30 * 1000;
// How often the poster re-checks which trip is active, so a trip accepted or
// completed on another screen is picked up without any screen coordination.
const TRIP_REFRESH_MS = 60 * 1000;

// ── Poster status pub/sub ──────────────────────────────────────────────────
// The poster is mounted once at the (app) layout level; screens subscribe to
// this to render their tracking chip without each owning a poster.
let posterStatus = {
  lastSentAt: null,
  error: null,
  geofence: null,
  geofenceTripId: null,
  monitor: null,
  monitorTripId: null,
  weather: null,
  weatherTripId: null,
  activeTripId: null,
  standbyObservedAt: null,
  // Raw motion evidence from the most recent fix, consumed by useIsDriving.
  // Published raw rather than as a verdict because the hold window in
  // ./motion-state is time-based: "is driving" has to be re-evaluated against a
  // clock, not only when new data lands.
  motionSpeedMs: null,
  motionFixAt: null,
};
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

/**
 * Imperative subscription to the poster status. Unlike `usePosterStatus` this
 * keeps nothing in React state, so a consumer that derives one boolean from the
 * status is not re-rendered on every publish. That matters here: the consumer
 * is the coach-mark provider, which wraps the entire app tree and would
 * otherwise re-render it every 30 s.
 *
 * @param {(status: object) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribePosterStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

// How often the hold window is re-checked against the clock. This bounds only
// how LATE the lock releases (the hold is whole minutes); engaging is immediate,
// because it happens on the fix itself rather than on a tick.
const MOTION_TICK_MS = 15 * 1000;

/**
 * Whether the vehicle is in motion right now — the input to the coach-mark
 * Driving Safety Lock (Capstone: Driver In-App Guide §7.1).
 *
 * Motion is sticky, per `./motion-state`: a fix at or above 10 km/h suppresses
 * tips for MOVING_HOLD_MS, and a later stationary fix does not release that
 * early — otherwise a red light would un-suppress the guide mid-route.
 *
 * Fails open by design: no location permission, tracking off in Settings, or no
 * fix yet all report `false`, so the in-app guide still works on a device that
 * never grants location. The lock engages only on positive evidence.
 *
 * @returns {boolean}
 */
export function useIsDriving() {
  const [isDriving, setIsDriving] = useState(false);
  const stateRef = useRef(createMotionState());
  const drivingRef = useRef(false);

  const apply = useCallback(() => {
    const next = isDrivingAt(stateRef.current, Date.now());
    if (next === drivingRef.current) return;
    drivingRef.current = next;
    setIsDriving(next);
  }, []);

  useEffect(
    () =>
      subscribePosterStatus((status) => {
        if (status.motionFixAt == null) return;
        stateRef.current = recordFix(stateRef.current, {
          speedMs: status.motionSpeedMs,
          atMs: new Date(status.motionFixAt).getTime(),
        });
        apply();
      }),
    [apply]
  );

  useEffect(() => {
    const interval = setInterval(apply, MOTION_TICK_MS);
    return () => clearInterval(interval);
  }, [apply]);

  return isDriving;
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
    if (!enabled || !settings.locationTracking) {
      publishStatus({ standbyObservedAt: null });
      if (enabled) api.post('/api/mobile/driver/standby-location', { enabled: false }, { queueOnFailure: false }).catch(() => {});
      return;
    }

    let cancelled = false;
    let interval = null;
    let tripId = null;
    let responderIncidentId = null;
    let standbyEnabled = false;
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
          const oldTripId = tripId;
          tripId = active?.trip_id ?? null;
          // Publish-on-change: the 60 s refresh must not re-render every
          // subscriber when nothing changed. On a trip change the weather
          // payload is also cleared immediately, so Trip A's weather can
          // never linger onto Trip B (or no trip) before the next post.
          if (oldTripId !== tripId) {
            publishStatus({
              activeTripId: tripId,
              weather: null,
              weatherTripId: null,
            });
          }
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

      const runTick = async () => {
        if (cancelled || AppState.currentState.match(/background|inactive/)) return;
        const now = Date.now();
        if (now - lastTripFetch >= TRIP_REFRESH_MS) {
          lastTripFetch = now;
          await findActiveTrip();
          await findResponderMission();
        }
        try {
          if (!tripId && !responderIncidentId) {
            const duty = await api.get('/api/mobile/driver/duty');
            if (cancelled) return;
            if (!duty?.checkedIn || duty.busy) {
              publishStatus({ standbyObservedAt: null });
              return;
            }
            if (!standbyEnabled) {
              await api.post('/api/mobile/driver/standby-location', { enabled:true }, { queueOnFailure:false });
              standbyEnabled = true;
              if (cancelled) {
                await api.post('/api/mobile/driver/standby-location', { enabled:false }, { queueOnFailure:false }).catch(() => {});
                return;
              }
            }
          } else publishStatus({ standbyObservedAt: null });
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          // Motion evidence is published for every fix, before the branch
          // below, so the driving gate sees it whether this driver is on a
          // trip, responding to an incident, or merely on standby. No extra GPS
          // read: this is the speed field this call already returned.
          // Deliberately NOT part of the publishes below, which are all
          // gated on a response — a fix is evidence even if its post fails.
          publishStatus({
            motionSpeedMs: loc.coords.speed ?? null,
            motionFixAt: new Date().toISOString(),
          });
          if (tripId) {
            // Trip GPS wins when both exist: it updates the same
            // drivers.current_* columns the responder evaluation reads, so
            // posting twice would only be a duplicate.
            const res = await api.post(`/api/mobile/driver/trips/${tripId}/gps`, {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              speed: loc.coords.speed ?? null,
              heading: loc.coords.heading ?? null,
              altitude: loc.coords.altitude ?? null,
              accuracy: loc.coords.accuracy ?? null,
              recorded_at: new Date(loc.timestamp).toISOString(),
            });
            // PR #3: the server describes this ping against the trip's
            // pickup/destination geofences. Screens turn near_* into a
            // human-confirmed arrival suggestion — never an auto-transition.
            // Tagged with the trip id so a completed trip's last banner
            // cannot linger onto the next assignment.
            //
            // PR #4: the same response carries the ingest-side monitor
            // verdict (off-route / traffic / GPS) for the map screen's
            // contextual banner — same trip-id tagging, same staleness rule.
            //
            // Weather chip (2026-09-09): the same response also carries the
            // current-conditions payload for the map screen's compact ambient
            // chip — same trip-id tagging, same staleness rule, null (chip
            // simply not rendered) when the provider call failed.
            if (!cancelled) {
              publishStatus({
                lastSentAt: new Date().toISOString(),
                error: null,
                geofence: res?.geofence ?? null,
                geofenceTripId: tripId,
                monitor: res?.monitor ?? null,
                monitorTripId: tripId,
                weather: res?.weather ?? null,
                weatherTripId: tripId,
              });
            }
          } else if (responderIncidentId) {
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
          } else {
            const res = await api.post('/api/mobile/driver/standby-location', {
              latitude: loc.coords.latitude, longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy, recorded_at: new Date(loc.timestamp).toISOString(),
            }, { queueOnFailure: false });
            if (!cancelled) publishStatus({ standbyObservedAt: res?.observedAt ?? null });
          }
          // The trip branch already published the full payload above; this
          // second publish is only for the responder path (which has none).
          // Publishing twice per tick re-rendered every subscriber for free.
          if (!cancelled && !tripId) publishStatus({ lastSentAt: new Date().toISOString(), error: null });
        } catch {
          // A dropped post is not worth interrupting the driver over; the next
          // tick retries. Only surface it so the chip can show it is stale.
          if (!cancelled) publishStatus({ error: "Location not sent. Retrying." });
        }      };

      let ticking = false;
      const tick = async () => {
        if (ticking) return;
        ticking = true;
        try { await runTick(); } finally { ticking = false; }
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
