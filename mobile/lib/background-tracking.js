import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { accumulateFix, createAccumulator } from "./gps-odometer";
import { hideTripBubble } from './trip-bubble';
import { tripBubbleWorkVersion } from './trip-bubble-handoff';
export { legForStatus } from "./trip-navigation-phase";

/**
 * Background location tracking for the driver's active trip.
 *
 * Why: expo-location's foreground `watchPositionAsync` stops firing once the app
 * is backgrounded (e.g. the driver opens Google Maps for turn-by-turn nav). This
 * module runs a headless TaskManager task that keeps posting the driver's GPS and
 * accumulating per-leg km while the app is in the background, so the web dashboard's
 * live map keeps updating and the odometer stays accurate across backgrounded
 * stretches.
 *
 * IMPORTANT (native): requires a development build — Expo Go cannot run background
 * location, and the currently-installed build lacks the native module/config, so a
 * rebuild + reinstall is needed. See app.json (expo-location plugin flags) and the
 * ACCESS_BACKGROUND_LOCATION / FOREGROUND_SERVICE / FOREGROUND_SERVICE_LOCATION
 * permissions.
 *
 * Map prepares this existing task before opening Google Maps, with an AppState
 * fallback for other background transitions. Delivery while FleetOps is active
 * is ignored so preflight cannot duplicate foreground GPS or distance.
 */

const TASK_NAME = "fleetops-background-location";
const BACKGROUND_OPTIONS = {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 10,
  timeInterval: 30000,
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  foregroundService: {
    notificationTitle: "FleetOps tracking active",
    notificationBody: "Sharing your live location with dispatch",
    notificationColor: "#0f766e",
  },
};

const STORAGE_KEY = "fleetops_bg_tracking";
// Shape: { tripId, leg, km1, km2, prev, pending }. Older records without
// `pending` remain valid and receive its null default when loaded.

// km between two lat/lng pairs and the segment acceptance rules now live in
// ./gps-odometer so the foreground watcher and this task cannot drift apart
// again. This module owns per-leg totals plus the shared anchor/recovery state.

const DEFAULT_CONTEXT = { tripId: null, leg: null, km1: 0, km2: 0, prev: null, pending: null };
// Foreground status/AppState events can arrive back-to-back. Serialize context
// writes so a slower read from an older trip cannot overwrite the newer trip.
let contextWrite = Promise.resolve();

async function loadContext() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONTEXT, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_CONTEXT };
}

async function saveContext(ctx) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // A failed persist means the km for this background stretch is lost; not
    // worth surfacing mid-trip.
  }
}

/**
 * The background task. Runs headless whenever the OS delivers a background
 * location update. It posts the fix to the same GPS endpoints the foreground
 * uses (so the web dashboard live map updates) and accumulates per-leg km into
 * AsyncStorage (merged back into the foreground accumulator on resume).
 */
async function processBackgroundLocations({ data, error }) {
  if (error || AppState.currentState === 'active') return;
  const { locations } = data || {};
  if (!locations || !locations.length) return;

  const ctx = await loadContext();
  if (AppState.currentState === 'active') return;

  for (const loc of locations) {
    if (AppState.currentState === 'active' || !ctx.tripId) break;
    const lat = loc.coords?.latitude;
    const lng = loc.coords?.longitude;
    if (lat == null || lng == null) continue;

    // GPS is trip-scoped. A driver without an active trip can still view their
    // local position, but the app must not persist idle/non-trip telemetry.
    const body = {
      latitude: lat,
      longitude: lng,
      speed: loc.coords?.speed ?? null,
      heading: loc.coords?.heading ?? null,
      altitude: loc.coords?.altitude ?? null,
      accuracy: loc.coords?.accuracy ?? null,
      recorded_at: loc.timestamp ? new Date(loc.timestamp).toISOString() : undefined,
    };
    if (ctx.tripId) {
      // queueOnFailure:false is load-bearing, not an optimisation. Live
      // location must never be replayed from the offline outbox: a queued ping
      // that syncs twenty minutes later would overwrite the driver's CURRENT
      // position with a stale one on the dispatcher's live map and in the
      // geofence/monitor verdicts derived from it. The responder and standby
      // branches of lib/tracking.js already say exactly this; the trip branch
      // and this task were the two that did not.
      const bubbleVersion = tripBubbleWorkVersion();
      const result = await api.post(`/api/mobile/driver/trips/${ctx.tripId}/gps`, body, { queueOnFailure: false }).catch(() => null);
      if (result?.tracked === false) {
        // An old reply must not remove a replacement handoff's shortcut.
        if (result.reason === 'trip-not-live' && bubbleVersion === tripBubbleWorkVersion()) await hideTripBubble();
        await saveContext({ ...DEFAULT_CONTEXT });
        await stopBackgroundTracking();
        return;
      }
    }

    // Accumulate km per leg through the SAME rules the foreground watcher uses
    // (./gps-odometer), so a backgrounded stretch cannot accumulate distance
    // the foreground would have rejected as jitter.
    if (ctx.tripId && ctx.leg) {
      const acc = createAccumulator();
      acc.leg1 = Number(ctx.km1) || 0;
      acc.leg2 = Number(ctx.km2) || 0;
      acc.leg = ctx.leg;
      acc.prev = ctx.prev || null;
      acc.pending = ctx.pending || null;
      accumulateFix(acc, {
        lat,
        lng,
        speedMs: loc.coords?.speed ?? null,
        atMs: loc.timestamp ?? null,
        leg: ctx.leg,
      });
      ctx.km1 = acc.leg1;
      ctx.km2 = acc.leg2;
      ctx.prev = acc.prev;
      ctx.pending = acc.pending;
    } else {
      ctx.prev = null;
      ctx.pending = null;
    }
  }

  await saveContext(ctx);
}

TaskManager.defineTask(TASK_NAME, event => {
  // Drain accepted deliveries before a return merge or replacement context write.
  const write = contextWrite.then(() => processBackgroundLocations(event));
  contextWrite = write.catch(() => {});
  return write;
});

async function ensureBackgroundTracking(requestPermission) {
  if (Platform.OS === "web") return { ok: false, reason: "unsupported" };
  try {
    const currentForeground = await Location.getForegroundPermissionsAsync();
    const foreground = currentForeground.status === "granted" || !requestPermission
      ? currentForeground
      : await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== "granted") return { ok: false, reason: "permission-denied" };
    const current = await Location.getBackgroundPermissionsAsync();
    const permission = current.status === "granted" || !requestPermission
      ? current
      : await Location.requestBackgroundPermissionsAsync();
    if (permission.status !== "granted") return { ok: false, reason: "permission-denied" };
    if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
      await Location.startLocationUpdatesAsync(TASK_NAME, BACKGROUND_OPTIONS);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "start-failed" };
  }
}

/** Prepare the trip context before checking or starting the native task. */
export async function prepareBackgroundTracking({ tripId, leg, requestPermission = false }) {
  if (Platform.OS === "web") return { ok: false, reason: "unsupported" };
  try {
    await updateLegContext({ tripId, leg });
    return ensureBackgroundTracking(requestPermission);
  } catch {
    return { ok: false, reason: "start-failed" };
  }
}

/** Compatibility for AppState callers that already saved their trip context. */
export async function startBackgroundTracking() {
  return ensureBackgroundTracking(true);
}

/**
 * Stop background location updates. Safe to call when not started.
 */
export async function stopBackgroundTracking() {
  if (Platform.OS === "web") return { ok: true };
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "stop-failed" };
  }
}

/**
 * Tell the background task which trip/leg is active. Called by the foreground on
 * every status change. The anchor and pending recovery fix are reset so a leg
 * transition's straddling gap is not counted. Existing km are preserved only
 * for the same trip.
 */
export async function updateLegContext({ tripId, leg }) {
  const write = contextWrite.then(async () => {
    const ctx = await loadContext();
    const nextTripId = tripId ?? null;
    if (ctx.tripId != null && String(ctx.tripId) !== String(nextTripId)) {
      // Distance totals belong to one trip. Never carry them into the next
      // assignment (or into an idle state) when the foreground changes first.
      ctx.km1 = 0;
      ctx.km2 = 0;
    }
    ctx.tripId = nextTripId;
    ctx.leg = leg ?? null;
    ctx.prev = null;
    ctx.pending = null;
    // Startup must not succeed with a stale trip/leg after a failed write.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  });
  contextWrite = write.catch(() => {});
  return write;
}

/**
 * Fold background-accumulated km into the foreground accumulator (`distRef`).
 * Called when the app returns to the foreground. Adds km1/km2 to the matching
 * leg, then clears the stored totals and fixes so the next background cycle
 * starts fresh.
 */
export async function mergeStoredKm(distRef, expectedTripId = null) {
  const write = contextWrite.then(async () => {
    const ctx = await loadContext();
    const sameTrip = expectedTripId != null && ctx.tripId != null && String(ctx.tripId) === String(expectedTripId);
    if (sameTrip) {
      if (ctx.km1 > 0) distRef.current.leg1 += ctx.km1;
      if (ctx.km2 > 0) distRef.current.leg2 += ctx.km2;
    }
    ctx.km1 = 0;
    ctx.km2 = 0;
    ctx.prev = null;
    ctx.pending = null;
    await saveContext(ctx);
  });
  contextWrite = write.catch(() => {});
  return write;
}
