import { useEffect } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { useAuth } from "./auth";
import { subscribeApiEvents } from "./api";
import { captureCargoSession, isCurrentCargoSession } from "./cargo-sync";
import { accumulateFix, createAccumulator } from "./gps-odometer";
import { startBackgroundTracking, stopBackgroundTracking, updateLegContext, mergeStoredKm, legForStatus } from "./background-tracking";

// The trip stream outlives the Map tab. The tab owns only its visual subscription.
const TRACKED_STATUSES = new Set(["Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"]);
const listeners = new Set();
let owner = null;
let latestLocation = null;
let trackedRevision = 0;
// A replacement signed-in owner must wait for the previous native task to stop.
let nativeWork = Promise.resolve();
const enqueueNative = (work) => { nativeWork = nativeWork.then(work, work).catch(() => {}); };

function publishLocation(location) {
  latestLocation = location;
  for (const listener of listeners) listener(location);
}

export function subscribeTripLocation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Latest raw Expo Location sample from this signed-in driver's active trip. */
export function getTripLocation() {
  return owner?.isCurrent() ? latestLocation : null;
}

export function setTrackedTrip(trip, read) {
  if (read !== undefined && (read?.owner !== owner || read?.revision !== trackedRevision)) return false;
  // A disabled location stream must not prevent the Map showing assignments.
  return owner ? owner.setTrip(trip) : read !== undefined;
}

// Capture before a request: another screen may confirm a newer leg while it waits.
export function captureTrackedTripRead() {
  return { owner, revision: trackedRevision };
}

export function retryTripLocation() {
  owner?.retry();
}

function createOwner(session) {
  let trip = null;
  let tripKnown = false;
  let generation = 0;
  let disposed = false;
  let foreground = null;
  let appActive = AppState.currentState === "active";
  const completedTrips = new Set();
  const distance = { current: createAccumulator() };
  const isCurrent = () => !disposed && isCurrentCargoSession(session);
  const stopForeground = () => { foreground?.remove(); foreground = null; };

  async function startForeground(expected) {
    const current = () => isCurrent() && generation === expected && appActive && trip != null;
    const unavailable = () => {
      if (!current()) return;
      distance.current.prev = null;
      distance.current.pending = null;
      publishLocation(null);
    };
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!current()) return;
      if (permission.status !== "granted") { unavailable(); return; }
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1500, distanceInterval: 3 },
        (location) => {
          if (!current()) return;
          const { latitude, longitude, speed } = location?.coords || {};
          if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
              !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
              !Number.isFinite(location?.timestamp)) { unavailable(); return; }
          accumulateFix(distance.current, {
            lat: latitude, lng: longitude, speedMs: speed ?? null,
            atMs: location.timestamp ?? null, leg: legForStatus(trip.trip_status),
          });
          publishLocation(location);
        },
        unavailable
      );
      // Native subscription creation may resolve after tab-independent cleanup.
      if (!current()) subscription.remove();
      else foreground = subscription;
    } catch {
      unavailable();
    }
  }

  function reconcile() {
    const expected = ++generation;
    stopForeground();
    distance.current.prev = null;
    distance.current.pending = null;
    const current = () => isCurrent() && generation === expected;
    enqueueNative(async () => {
      if (!current()) return;
      if (!trip) {
        await stopBackgroundTracking();
        if (current()) await updateLegContext({ tripId: null, leg: null });
        return;
      }
      if (appActive) {
        await stopBackgroundTracking();
        if (!current()) return;
        // Capture this accumulator: a slow merge must never add the old trip's
        // mileage to a replacement trip created while storage was being read.
        await mergeStoredKm({ current: distance.current }, trip.trip_id);
        if (!current()) return;
        await updateLegContext({ tripId: trip.trip_id, leg: legForStatus(trip.trip_status) });
        if (current()) startForeground(expected);
      } else {
        await updateLegContext({ tripId: trip.trip_id, leg: legForStatus(trip.trip_status) });
        if (!current()) return;
        await startBackgroundTracking();
        // Completion, signout or foreground return may win during the OS start.
        if (!current()) await stopBackgroundTracking();
      }
    });
  }

  function setTrip(next) {
    if (!isCurrent()) return false;
    if (next?.trip_id == null || !TRACKED_STATUSES.has(next.trip_status) || completedTrips.has(String(next.trip_id))) next = null;
    if (tripKnown && String(trip?.trip_id ?? "") === String(next?.trip_id ?? "") && trip?.trip_status === next?.trip_status) return true;
    tripKnown = true;
    trackedRevision += 1;
    const changedTrip = String(trip?.trip_id ?? "") !== String(next?.trip_id ?? "");
    trip = next;
    if (changedTrip) {
      distance.current = createAccumulator();
      publishLocation(null);
    }
    reconcile();
    return true;
  }

  const appSubscription = AppState.addEventListener("change", (next) => {
    const active = next === "active";
    if (active === appActive) return;
    appActive = active;
    reconcile();
  });
  const unsubscribe = subscribeApiEvents((event) => {
    if (event.type !== "trip-completed") return;
    trackedRevision += 1;
    completedTrips.add(String(event.tripId));
    if (String(event.tripId) === String(trip?.trip_id)) setTrip(null);
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    trackedRevision += 1;
    generation += 1;
    trip = null;
    stopForeground();
    appSubscription.remove();
    unsubscribe();
    session.signal.removeEventListener("abort", dispose);
    publishLocation(null);
    enqueueNative(async () => {
      await stopBackgroundTracking();
      await updateLegContext({ tripId: null, leg: null });
    });
  }
  session.signal.addEventListener("abort", dispose, { once: true });
  return {
    setTrip, dispose, isCurrent,
    retry() {
      if (!isCurrent() || !trip) return;
      publishLocation(null);
      reconcile();
    },
  };
}

/** Mounted once beside the uploader, independent of the visible screen. */
export function useTripLocationOwner(enabled) {
  const { user } = useAuth();
  const actorId = user?.employeeId;
  useEffect(() => {
    const previous = owner;
    previous?.dispose();
    owner = null;
    const session = enabled ? captureCargoSession(actorId) : null;
    if (!session || !isCurrentCargoSession(session)) {
      if (!previous) enqueueNative(async () => {
        await stopBackgroundTracking();
        await updateLegContext({ tripId: null, leg: null });
      });
      return;
    }
    const current = createOwner(session);
    owner = current;
    return () => {
      current.dispose();
      if (owner === current) owner = null;
    };
  }, [enabled, actorId]);
}
