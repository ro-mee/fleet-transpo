import { useEffect } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { useAuth } from "./auth";
import { subscribeApiEvents } from "./api";
import { captureCargoSession, isCurrentCargoSession } from "./cargo-sync";
import { accumulateFix, createAccumulator } from "./gps-odometer";
import { prepareBackgroundTracking, startBackgroundTracking, stopBackgroundTracking, updateLegContext, mergeStoredKm, legForStatus } from "./background-tracking";

// The trip stream outlives the Map tab. The tab owns only its visual subscription.
const TRACKED_STATUSES = new Set(["Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"]);
const listeners = new Set();
const trackingListeners = new Set();
const IDLE_TRACKING = Object.freeze({ tripId: null, leg: null, state: "idle", reason: null });
let trackingStatus = IDLE_TRACKING;
let owner = null;
let latestLocation = null;
let trackedRevision = 0;
// A replacement signed-in owner must wait for the previous native task to stop.
let nativeWork = Promise.resolve();
const enqueueNative = (work) => {
  const result = nativeWork.then(work, work);
  nativeWork = result.catch(() => {});
  return result;
};

function publishTrackingStatus(status) {
  trackingStatus = Object.freeze(status);
  for (const listener of trackingListeners) listener(trackingStatus);
}

/** Native registration readiness, never proof of GPS delivery. */
export function getTripTrackingStatus() {
  return owner?.isCurrent() ? trackingStatus : IDLE_TRACKING;
}

export function subscribeTripTrackingStatus(listener) {
  trackingListeners.add(listener);
  return () => trackingListeners.delete(listener);
}

/** All native preparation stays in the same owner/queue as AppState cleanup. */
export async function prepareTripNavigation(options) {
  return owner?.prepareNavigation(options) ?? { ok: false, reason: "stale-trip" };
}

/** Release foreground preparation after a failed or abandoned Maps launch. */
export async function cancelTripNavigation(options) {
  return owner?.cancelNavigation(options) ?? { ok: false, reason: "stale-trip" };
}

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
  const setTrackingStatus = (state, reason = null) => publishTrackingStatus({
    tripId: trip?.trip_id ?? null, leg: trip ? legForStatus(trip.trip_status) : null, state, reason,
  });
  const navigationCurrent = (tripId, leg, expected) => isCurrent() && generation === expected && appActive &&
    tripId != null && String(trip?.trip_id) === String(tripId) &&
    leg != null && legForStatus(trip?.trip_status) === leg;

  function prepareNavigation({ tripId, leg, requestPermission = false } = {}) {
    const expected = generation;
    const current = () => navigationCurrent(tripId, leg, expected);
    if (!current()) return Promise.resolve({ ok: false, reason: "stale-trip" });
    setTrackingStatus("preparing");
    return enqueueNative(async () => {
      if (!current()) return { ok: false, reason: "stale-trip" };
      let ready;
      try { ready = await prepareBackgroundTracking({ tripId, leg, requestPermission, isCurrent: current }); }
      catch { ready = { ok: false, reason: "start-failed" }; }
      if (!current()) {
        await stopBackgroundTracking();
        return { ok: false, reason: "stale-trip" };
      }
      if (ready?.ok !== true) {
        await stopBackgroundTracking();
        if (!current()) return { ok: false, reason: "stale-trip" };
        ready = { ok: false, reason: ready?.reason || "start-failed" };
      }
      setTrackingStatus(ready.ok ? "ready" : "paused", ready.reason ?? null);
      return ready;
    });
  }

  function cancelNavigation({ tripId, leg } = {}) {
    const expected = generation;
    const current = () => navigationCurrent(tripId, leg, expected);
    return enqueueNative(async () => {
      if (!current()) return { ok: false, reason: "stale-trip" };
      const result = await stopBackgroundTracking();
      if (!current()) return { ok: false, reason: "stale-trip" };
      setTrackingStatus(result?.ok === false ? "paused" : "idle", result?.reason ?? null);
      return result ?? { ok: true };
    });
  }

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
    const expectedTrip = trip;
    // Preserve a failed departure for the returning Map until an explicit retry.
    if (!trip || trackingStatus.state !== "paused") setTrackingStatus("idle");
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
        let result;
        try {
          await updateLegContext({ tripId: trip.trip_id, leg: legForStatus(trip.trip_status) });
          if (!current()) return;
          result = await startBackgroundTracking(false, current);
        } catch { result = { ok: false, reason: "start-failed" }; }
        // Completion, signout or foreground return may win during the OS start.
        if (!current()) {
          await stopBackgroundTracking();
          // A real failure remains useful after return; stale/cancelled work does not.
          if (isCurrent() && appActive && trip === expectedTrip && trackingStatus.state !== "preparing" &&
              result?.ok === false && result.reason !== "stale-trip") setTrackingStatus("paused", result.reason || "start-failed");
        }
        else setTrackingStatus(result?.ok === true ? "ready" : "paused", result?.ok === true ? null : result?.reason || "start-failed");
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
    setTrackingStatus("idle");
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
    publishTrackingStatus(IDLE_TRACKING);
    enqueueNative(async () => {
      await stopBackgroundTracking();
      await updateLegContext({ tripId: null, leg: null });
    });
  }
  session.signal.addEventListener("abort", dispose, { once: true });
  return {
    setTrip, dispose, isCurrent, prepareNavigation, cancelNavigation,
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
